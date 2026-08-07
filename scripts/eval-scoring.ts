// Scoring functions for the planner eval harness (scripts/eval-planner.ts).
// Three independent, composable scorers per query: tool selection (heuristic),
// relevance (heuristic, reuses scores already computed by the tools), and
// groundedness (LLM-as-judge, the one check that needs actual judgment).
import OpenAI from 'openai';
import type { EvalQuery } from './eval-queries';
import type { GatheredContext } from '@/lib/agent/planner';

// --- 1. Tool selection (heuristic) ---------------------------------------

export interface ToolSelectionScore {
  pass: boolean;
  calledTools: string[];
  missingExpected: string[]; // expected but never called
  extraTools: string[]; // called but not in expectedTools (not a failure, just noted)
  fallbackRan: boolean; // true when gatherContextFixed ran instead of the real loop
}

// When the hard fallback runs (gatherContextFixed), trace is a single
// toolName:null sentinel step (lib/agent/planner.ts) — the fallback calls
// retrieveContext/webSearch directly, not through MCP, so no per-tool trace
// exists. Infer "called" from what was actually gathered (keptRagResults /
// keptWebResults) instead, so a working fallback doesn't score as a hard
// failure just because it isn't traced the same way as the real loop.
export function scoreToolSelection(query: EvalQuery, result: GatheredContext): ToolSelectionScore {
  const calledTools = result.plannerUsed
    ? [...new Set(result.trace.map((s) => s.toolName).filter((t): t is string => t !== null))]
    : [
        ...(result.keptRagResults.length > 0 ? (['rag_retrieve'] as const) : []),
        ...(result.keptWebResults.length > 0 ? (['web_search'] as const) : []),
      ];
  const missingExpected = query.expectedTools.filter((t) => !calledTools.includes(t));
  const extraTools = calledTools.filter((t) => !query.expectedTools.includes(t as EvalQuery['expectedTools'][number]));
  return { pass: missingExpected.length === 0, calledTools, missingExpected, extraTools, fallbackRan: !result.plannerUsed };
}

// --- 2. Relevance (heuristic, reads scores the tools already computed) ---

export interface RelevanceScore {
  ragSimilarities: number[]; // similarity values of RAG chunks kept in the compiled prompt
  webScores: number[]; // Tavily score values of web sources kept in the compiled prompt
  emptyResultTurns: number; // tool calls that returned zero results (a "whiff")
  finalRagCount: number; // RAG chunks kept after dedupe (in the compiled prompt)
  finalWebCount: number; // web sources kept after dedupe+cap (webSources.length)
}

// Read the exact deduped/capped results the prompt was built from
// (GatheredContext.keptRagResults/keptWebResults), not trace[].observation —
// that field is truncated to OBSERVATION_TRACE_LIMIT (500 chars) for storage
// and will not reliably contain every result's trailing similarity/score field.
export function scoreRelevance(_query: EvalQuery, result: GatheredContext): RelevanceScore {
  const ragSimilarities = result.keptRagResults.map((r) => r.similarity);
  const webScores = result.keptWebResults.map((r) => r.score);

  // A "whiff" is a successful tool call that returned zero results. An empty
  // {"results": []} / {"relevantResults": []} observation is always short
  // enough to survive the 500-char trace truncation intact, so parsing it is
  // safe here even though it isn't safe for extracting full result arrays.
  const emptyResultTurns = result.trace.filter((step) => {
    if (step.isError || !step.toolName || !step.observation) return false;
    try {
      const parsed = JSON.parse(step.observation);
      const arr = parsed.relevantResults ?? parsed.results;
      return Array.isArray(arr) && arr.length === 0;
    } catch {
      return false;
    }
  }).length;

  return {
    ragSimilarities,
    webScores,
    emptyResultTurns,
    finalRagCount: result.keptRagResults.length,
    finalWebCount: result.webSources.length,
  };
}

// --- 3. Groundedness (LLM-as-judge) ---------------------------------------

export interface GroundednessScore {
  score: number | null; // 1-5, null if the judge call or parse failed
  reason: string;
}

const JUDGE_MODEL = 'llama-3.3-70b-versatile'; // same model the planner itself uses, no new dependency

const JUDGE_SYSTEM_PROMPT = `You are a strict evaluator for a research assistant's context-gathering step.
You will see a research query and the context that was gathered to help answer it
(excerpts from past research and/or live web sources). Judge ONLY whether this
context is topically relevant and sufficient to ground an answer to the query.
Do not judge writing quality or completeness of a final report; that comes later.

Respond with ONLY a JSON object, no other text: {"score": <1-5 integer>, "reason": "<one sentence>"}
Scoring guide:
5 = context is clearly on-topic and covers the query's main angles
3 = context is partially relevant or covers only some angles
1 = context is off-topic or unrelated to the query (e.g. wrong meaning of an ambiguous term)`;

function getJudgeClient() {
  return new OpenAI({
    apiKey: process.env.GROQ_API_KEY || '',
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

// Judge only the gathered context (RAG/web excerpts), not the original query
// restated back, and not the planner's own closing note; a compact excerpt
// keeps this a cheap, narrow call rather than re-running the full prompt.
function extractContextExcerpt(augmentedPrompt: string, maxChars = 3000): string {
  const marker = augmentedPrompt.indexOf('---');
  const excerpt = marker >= 0 ? augmentedPrompt.slice(marker) : augmentedPrompt;
  return excerpt.slice(0, maxChars);
}

export async function scoreGroundedness(query: EvalQuery, result: GatheredContext): Promise<GroundednessScore> {
  const contextExcerpt = extractContextExcerpt(result.augmentedPrompt);
  if (!contextExcerpt.trim()) {
    return { score: null, reason: 'no context was gathered to judge' };
  }

  try {
    const client = getJudgeClient();
    const completion = await client.chat.completions.create({
      model: JUDGE_MODEL,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Research query: ${query.prompt}\n\nGathered context:\n${contextExcerpt}`,
        },
      ],
      temperature: 0,
      max_tokens: 150,
    });
    const raw = completion.choices[0].message.content?.trim() ?? '';
    const parsed = JSON.parse(raw) as { score?: number; reason?: string };
    if (typeof parsed.score !== 'number' || parsed.score < 1 || parsed.score > 5) {
      return { score: null, reason: `judge returned an unparseable score: ${raw.slice(0, 100)}` };
    }
    return { score: parsed.score, reason: parsed.reason ?? '(no reason given)' };
  } catch (error) {
    return { score: null, reason: `judge call failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
