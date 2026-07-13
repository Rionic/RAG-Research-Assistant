// ReAct planner loop: an LLM decides which context-gathering tools to call
// (rag_retrieve / web_search), with what queries, reading each observation
// before choosing the next action — consuming the tools through the
// in-process MCP client (lib/mcp/client.ts).
//
// v1 scope is context gathering only. The final research prompt is compiled
// programmatically from the ACCUMULATED tool results (verifiable grounding),
// not from the planner's own summary; generation/embed/PDF/email stay fixed.
//
// NOTE: must not import from lib/research.ts — research.ts imports this file.
import OpenAI from 'openai';
import { getMcpClient } from '@/lib/mcp/client';
import { retrieveContext } from '@/lib/rag';
import { webSearch, WebSearchResult } from '@/lib/tools/webSearch';
import { augmentPromptWithPastResearch, augmentPromptWithWebSources } from '@/lib/prompts';
import { SearchResult } from '@/lib/rag/qdrant';
import { PlannerTraceStep, WebSource } from '@/types';

const PLANNER_MODEL = 'llama-3.3-70b-versatile';
const MAX_ITERATIONS = 6;
// v1: gathering tools only — the planner never sees rag_embed/generate_pdf/send_email
const ALLOWED_TOOLS = new Set(['rag_retrieve', 'web_search']);
const OBSERVATION_TRACE_LIMIT = 500;
// Caps on the compiled prompt: the planner can gather more than the old fixed
// sequence (multiple searches), but Groq free tier limits request size
// (openai/gpt-oss-20b: 8000 TPM incl. max_tokens) — keep the input bounded
const MAX_RAG_RESULTS = 5;
const MAX_WEB_RESULTS = 6;
const WEB_CONTENT_CHAR_LIMIT = 800;

const PLANNER_SYSTEM_PROMPT = `You are the research planning agent for a research assistant. Your job is to
gather the context needed to answer the user's research request — NOT to
answer the request yourself.

You have two tools:
- rag_retrieve: semantic search over this user's past completed research
  reports. Cheap and already synthesized. Call it FIRST whenever the topic
  could plausibly overlap with something the user researched before. An empty
  relevantResults array means no prior research exists — that is not an
  error, move on to the web.
- web_search: live web search for current facts, news, and citable sources.

How to work:
1. If past research could plausibly be relevant, call rag_retrieve first.
2. Use web_search for anything needing fresh or citable information. Write
   focused queries — two or three targeted searches beat one vague one.
3. Read every tool result before deciding the next step. Refine queries based
   on what you learned. Never repeat a query that already returned useful
   results; rephrase queries that returned nothing.
4. If a tool returns an error message, read it and adapt — fix your arguments
   or switch to the other tool.
5. Stop as soon as you have enough context to cover the request's main
   angles. You have a hard budget of ${MAX_ITERATIONS} planning turns; use fewer if fewer
   suffice.

When you have enough context, reply WITHOUT calling any tools, with 1-3
sentences stating what the downstream research should focus on. Do NOT write
the research report or answer the question yourself — the sources you
gathered are compiled automatically.`;

export interface GatheredContext {
  augmentedPrompt: string; // LLM input only — never persisted
  webSources: WebSource[]; // deduped by URL, persisted → PDF/email citations
  trace: PlannerTraceStep[];
  plannerUsed: boolean; // false when the fixed-sequence fallback ran
}

// Planner builds its own Groq client rather than importing getOpenAI from
// lib/research.ts (circular import)
function getPlannerClient() {
  return new OpenAI({
    apiKey: process.env.GROQ_API_KEY || '',
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

// Entry point for performResearch. Never throws — any hard planner failure
// (Groq outage, MCP connect failure) falls back to the old fixed sequence
// so research always completes.
export async function gatherContext(prompt: string, userId: string): Promise<GatheredContext> {
  try {
    return await runPlannerLoop(prompt, userId);
  } catch (error) {
    console.error('Planner loop failed, falling back to fixed RAG+web sequence:', error);
    return gatherContextFixed(prompt, userId);
  }
}

async function runPlannerLoop(prompt: string, userId: string): Promise<GatheredContext> {
  const client = await getMcpClient();

  // MCP tool schemas translate directly into OpenAI function-calling format
  const { tools } = await client.listTools();
  const openAiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools
    .filter((t) => ALLOWED_TOOLS.has(t.name))
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: stripUserId(t.name, t.inputSchema as Record<string, unknown>),
      },
    }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: `Research request:\n${prompt}` },
  ];

  const ragResults: SearchResult[] = [];
  const webResults: WebSearchResult[] = [];
  const trace: PlannerTraceStep[] = [];
  let finalNote: string | null = null;
  const openai = getPlannerClient();

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const completion = await openai.chat.completions.create({
      model: PLANNER_MODEL,
      messages,
      tools: openAiTools,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1024,
    });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Conclude: the model decided it has enough context
      finalNote = msg.content?.trim() || null;
      trace.push({
        step: iteration,
        thought: finalNote,
        toolName: null,
        arguments: null,
        observation: null,
        isError: false,
        durationMs: 0,
      });
      break;
    }

    // llama-3.3-70b may emit parallel tool calls — every tool_call_id must get
    // a role:'tool' reply or the next API call is rejected
    for (const toolCall of msg.tool_calls) {
      if (toolCall.type !== 'function') continue;
      const started = Date.now();
      let args: Record<string, unknown> | null = null;
      let observation: string;
      let isError = false;

      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        observation = `Error: tool arguments were not valid JSON (${toolCall.function.arguments}). Retry with corrected arguments.`;
        isError = true;
      }

      if (args !== null) {
        if (toolCall.function.name === 'rag_retrieve') {
          // Server-side identity injection — overrides anything the model sent
          args.userId = userId;
        }
        try {
          const result = await client.callTool({
            name: toolCall.function.name,
            arguments: args,
          });
          observation = extractText(result.content);
          isError = result.isError === true;
          if (!isError) {
            accumulate(toolCall.function.name, observation, ragResults, webResults);
          }
        } catch (error) {
          // e.g. the model invented a tool name — feed the failure back as an observation
          observation = `Error: ${error instanceof Error ? error.message : String(error)}`;
          isError = true;
        }
      }

      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: observation! });
      trace.push({
        step: iteration,
        thought: msg.content?.trim() || null,
        toolName: toolCall.function.name,
        arguments: args,
        observation: observation!.slice(0, OBSERVATION_TRACE_LIMIT),
        isError,
        durationMs: Date.now() - started,
      });
    }
  }

  // Compile the final prompt from accumulated observations (also covers
  // cap exhaustion — no extra LLM call needed). Dedupe (repeated queries
  // overlap), then cap so the compiled prompt stays within Groq request limits.
  // webSources lists exactly what went into the prompt, so citations stay honest
  const dedupedRag = dedupeBy(ragResults, (r) => `${r.sessionId}:${r.text}`).slice(0, MAX_RAG_RESULTS);
  const dedupedWeb = dedupeBy(webResults, (r) => r.url)
    .slice(0, MAX_WEB_RESULTS)
    .map((r) => ({ ...r, content: r.content.slice(0, WEB_CONTENT_CHAR_LIMIT) }));
  const webSources: WebSource[] = dedupedWeb.map((r) => ({ title: r.title, url: r.url }));

  let augmentedPrompt = prompt;
  if (dedupedRag.length > 0) {
    augmentedPrompt = augmentPromptWithPastResearch(augmentedPrompt, { relevantResults: dedupedRag });
  }
  if (dedupedWeb.length > 0) {
    augmentedPrompt = augmentPromptWithWebSources(augmentedPrompt, dedupedWeb);
  }
  if (finalNote) {
    augmentedPrompt += `\n\n---\nResearch focus (from the planning phase): ${finalNote}`;
  }

  return { augmentedPrompt, webSources, trace, plannerUsed: true };
}

// The pre-planner fixed sequence, kept as the fallback path. Never throws —
// each step degrades gracefully, same as the old route code.
async function gatherContextFixed(prompt: string, userId: string): Promise<GatheredContext> {
  let augmentedPrompt = prompt;
  let webSources: WebSource[] = [];

  try {
    const ragContext = await retrieveContext(prompt, userId);
    if (ragContext.relevantResults.length > 0) {
      augmentedPrompt = augmentPromptWithPastResearch(augmentedPrompt, ragContext);
    }
  } catch (error) {
    console.error('Fallback RAG retrieval failed, continuing without:', error);
  }

  try {
    const { results } = await webSearch(prompt);
    if (results.length > 0) {
      augmentedPrompt = augmentPromptWithWebSources(augmentedPrompt, results);
      webSources = results.map((r) => ({ title: r.title, url: r.url }));
    }
  } catch (error) {
    console.error('Fallback web search failed, continuing without:', error);
  }

  return {
    augmentedPrompt,
    webSources,
    // Sentinel step so the trace records that the planner didn't run
    trace: [
      {
        step: 0,
        thought: 'planner unavailable — fixed RAG+web fallback',
        toolName: null,
        arguments: null,
        observation: null,
        isError: true,
        durationMs: 0,
      },
    ],
    plannerUsed: false,
  };
}

// For rag_retrieve, hide userId from the model — the loop injects it at call time
function stripUserId(toolName: string, schema: Record<string, unknown>): Record<string, unknown> {
  if (toolName !== 'rag_retrieve') return schema;
  const copy = JSON.parse(JSON.stringify(schema)) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (copy.properties) delete copy.properties.userId;
  if (Array.isArray(copy.required)) copy.required = copy.required.filter((k) => k !== 'userId');
  return copy;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

// Tool handlers JSON.stringify their payloads (lib/mcp/tools.ts) — parse them
// back so the compiled prompt is built from real results, not model summaries
function accumulate(
  toolName: string,
  observation: string,
  ragResults: SearchResult[],
  webResults: WebSearchResult[]
): void {
  try {
    const parsed = JSON.parse(observation);
    if (toolName === 'rag_retrieve' && Array.isArray(parsed.relevantResults)) {
      ragResults.push(...parsed.relevantResults);
    }
    if (toolName === 'web_search' && Array.isArray(parsed.results)) {
      webResults.push(...parsed.results);
    }
  } catch {
    console.warn(`Planner: could not parse ${toolName} observation as JSON; skipping accumulation`);
  }
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
