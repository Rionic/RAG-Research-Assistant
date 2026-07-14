// MCP tool registry: wraps the app's existing capabilities (web search, RAG,
// PDF generation, email delivery) as discrete MCP tools.
// Transport-agnostic: imported by both the Streamable HTTP route
// (app/api/mcp/[transport]/route.ts) and the stdio entry (scripts/mcp-stdio.ts).
// Tool descriptions are written for an LLM planner audience; the future ReAct
// loop (step 2 of the roadmap) selects between these tools at each step.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { webSearch } from '@/lib/tools/webSearch';
import { retrieveContext, embedResearchResults } from '@/lib/rag';
import { generateResearchPDF } from '@/lib/pdf-generator';
import { sendResearchReport } from '@/lib/email-sender';
import { adminDb } from '@/lib/firebase-admin';
import { ResearchSession } from '@/types';

// Session-shaped tools take a sessionId and fetch server-side rather than
// round-tripping multi-KB session JSON through the model. Firestore Timestamps
// flow through untouched; pdf-generator/email-sender already handle that shape.
async function getSession(sessionId: string): Promise<ResearchSession> {
  const snap = await adminDb.collection('research_sessions').doc(sessionId).get();
  if (!snap.exists) {
    throw new Error(`No research session found with id "${sessionId}"`);
  }
  return snap.data() as ResearchSession;
}

// Surface failures as tool observations (isError) rather than protocol errors,
// so a planner can read "TAVILY_API_KEY must be set" and adapt instead of crashing.
function withToolErrors<Args extends unknown[]>(
  fn: (...args: Args) => Promise<CallToolResult>
): (...args: Args) => Promise<CallToolResult> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  };
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    'web_search',
    {
      title: 'Web search',
      description:
        'Search the live web (via Tavily) for current information. Use when the question needs ' +
        'fresh facts, news, or citable sources. Prefer rag_retrieve first when the topic may ' +
        'overlap with research this user has already completed; it returns already-synthesized ' +
        'findings and is cheaper. Returns a JSON list of {title, url, content, score} snippets ' +
        '(score = relevance, 0-1; low-relevance results are filtered out server-side). An empty ' +
        'results list means the query missed; rephrase with more specific or disambiguating terms.',
      inputSchema: {
        query: z.string().min(2).describe('Natural-language search query'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Maximum number of results to return'),
      },
    },
    withToolErrors(async ({ query, maxResults }) => {
      const { results } = await webSearch(query, maxResults);
      return textResult(JSON.stringify({ results }, null, 2));
    })
  );

  server.registerTool(
    'rag_retrieve',
    {
      title: 'Retrieve past research',
      description:
        "Semantic search over this user's past completed research reports (vector memory in " +
        'Qdrant). Call this BEFORE web_search when the question might overlap with prior ' +
        'research. Returns JSON chunks with cosine similarity >= 0.6; an empty relevantResults ' +
        'array means no relevant past research exists (not an error). Note: the first call ' +
        'after a cold start may take 30-60s while the embedding model loads.',
      inputSchema: {
        query: z.string().min(1).describe('Natural-language query to match against past research'),
        userId: z.string().min(1).describe('Firebase user id whose research memory to search'),
        topK: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Maximum number of chunks to return'),
      },
    },
    withToolErrors(async ({ query, userId, topK }) => {
      const context = await retrieveContext(query, userId, topK);
      return textResult(JSON.stringify(context, null, 2));
    })
  );

  server.registerTool(
    'rag_embed',
    {
      title: 'Embed research into memory',
      description:
        "Persist a completed research session's findings into long-term vector memory so future " +
        'rag_retrieve calls can find them. Call exactly once per session, after research results ' +
        'exist; calling twice duplicates memory entries. Note: may take 30-60s on the first ' +
        'call after a cold start while the embedding model loads.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Id of a completed research session to embed'),
      },
    },
    withToolErrors(async ({ sessionId }) => {
      const session = await getSession(sessionId);
      if (!session.openaiResult && !session.geminiResult) {
        throw new Error(
          `Session "${sessionId}" has no research results to embed yet (status: ${session.status})`
        );
      }
      const { pointsEmbedded } = await embedResearchResults(session);
      return textResult(`Embedded ${pointsEmbedded} chunks for session ${sessionId}`);
    })
  );

  server.registerTool(
    'generate_pdf',
    {
      title: 'Generate PDF report',
      description:
        "Render a research session's report as a PDF document, returned as a base64-encoded " +
        'resource. Use when the caller wants the report artifact itself. If the goal is to ' +
        'deliver the report to the user by email, call send_email instead; it generates and ' +
        'attaches the PDF automatically.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Id of the research session to render'),
      },
    },
    withToolErrors(async ({ sessionId }) => {
      const session = await getSession(sessionId);
      const pdf = await generateResearchPDF(session);
      return {
        content: [
          {
            type: 'text',
            text: `Generated PDF report (${pdf.length} bytes) for session ${sessionId}.`,
          },
          {
            type: 'resource',
            resource: {
              uri: `research-assistant://sessions/${sessionId}/report.pdf`,
              mimeType: 'application/pdf',
              blob: pdf.toString('base64'),
            },
          },
        ],
      };
    })
  );

  server.registerTool(
    'send_email',
    {
      title: 'Email research report',
      description:
        "Email the completed research report to the session's registered user, with the PDF " +
        'report attached. Terminal delivery step; does not require calling generate_pdf first.',
      inputSchema: {
        sessionId: z.string().min(1).describe('Id of the research session to deliver'),
      },
    },
    withToolErrors(async ({ sessionId }) => {
      const session = await getSession(sessionId);
      await sendResearchReport(session);
      return textResult(`Report emailed to ${session.userEmail} with PDF attached.`);
    })
  );
}
