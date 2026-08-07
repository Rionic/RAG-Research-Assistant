// Eval harness for the ReAct planner (roadmap item 3). Runs the fixed query
// set in scripts/eval-queries.ts through gatherContext directly (in-process
// MCP client, same call the app makes) and scores each result on tool
// selection, relevance, and groundedness. Diagnostic tool, not a CI gate:
// prints a summary table and writes full detail to scripts/eval-results/.
//
// Usage: npm run eval:planner
import { config } from 'dotenv';
// Project secrets live in .env.local; load before any lib import touches env
// vars at import time (e.g. lib/email-sender.ts's sgMail.setApiKey)
config({ path: ['.env.local', '.env'] });

// The eval harness makes many Groq calls per run (22 planner loops + judge
// calls) and shares the free-tier 100k-token daily quota with the live app
// otherwise — an eval run has starved real research requests before. If a
// dedicated GROQ_EVAL_API_KEY is set, redirect GROQ_API_KEY to it for this
// process only, before any lib code (which reads GROQ_API_KEY directly)
// gets imported. Falls back to the shared key with a warning if unset.
if (process.env.GROQ_EVAL_API_KEY) {
  process.env.GROQ_API_KEY = process.env.GROQ_EVAL_API_KEY;
  console.log('[eval] using dedicated GROQ_EVAL_API_KEY (isolated from the live app\'s quota)');
} else {
  console.warn(
    '[eval] WARNING: no GROQ_EVAL_API_KEY set — this run will consume the same daily Groq quota ' +
      'as the live app. Set GROQ_EVAL_API_KEY in .env.local to isolate eval runs (see .env.example).'
  );
}

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const { gatherContext } = await import('@/lib/agent/planner');
  const { EVAL_QUERIES, EVAL_USER_ID } = await import('./eval-queries');
  const { scoreToolSelection, scoreRelevance, scoreGroundedness } = await import('./eval-scoring');

  console.log(`[eval] running ${EVAL_QUERIES.length} queries sequentially (Groq free-tier TPM limits rule out parallel)\n`);

  const runResults = [];

  for (const query of EVAL_QUERIES) {
    const started = Date.now();
    const gathered = await gatherContext(query.prompt, EVAL_USER_ID);
    const toolScore = scoreToolSelection(query, gathered);
    const relevanceScore = scoreRelevance(query, gathered);
    const groundedness = await scoreGroundedness(query, gathered);
    const durationMs = Date.now() - started;

    console.log(
      `[eval] ${query.id.padEnd(10)} [${query.category.padEnd(11)}] ` +
        `tools=${toolScore.pass ? 'PASS' : 'FAIL'} ` +
        `groundedness=${groundedness.score ?? 'ERR'}/5 ` +
        `plannerUsed=${gathered.plannerUsed} ` +
        `(${durationMs}ms)`
    );
    if (!toolScore.pass) {
      console.log(`         missing expected tools: ${toolScore.missingExpected.join(', ')}`);
    }

    runResults.push({ query, gathered, toolScore, relevanceScore, groundedness, durationMs });
  }

  printSummary(runResults);
  writeJsonReport(runResults);
}

function printSummary(
  results: Array<{
    query: { id: string; category: string };
    toolScore: { pass: boolean; fallbackRan: boolean };
    relevanceScore: { ragSimilarities: number[]; webScores: number[]; emptyResultTurns: number };
    groundedness: { score: number | null };
  }>
) {
  console.log('\n=== SUMMARY ===\n');

  const fallbackCount = results.filter((r) => r.toolScore.fallbackRan).length;
  if (fallbackCount > 0) {
    console.log(
      `⚠ planner fallback ran on ${fallbackCount}/${results.length} queries (Groq outage or rate limit during this run) — ` +
        `tool-selection scores below are inferred from gathered results, not the real loop's trace.\n`
    );
  }

  const categories = [...new Set(results.map((r) => r.query.category))];
  for (const category of categories) {
    const inCategory = results.filter((r) => r.query.category === category);
    const passRate = inCategory.filter((r) => r.toolScore.pass).length / inCategory.length;
    const groundednessScores = inCategory.map((r) => r.groundedness.score).filter((s): s is number => s !== null);
    const avgGroundedness = groundednessScores.length
      ? (groundednessScores.reduce((a, b) => a + b, 0) / groundednessScores.length).toFixed(2)
      : 'n/a';
    console.log(
      `${category.padEnd(12)} n=${inCategory.length}  tool-selection pass rate=${(passRate * 100).toFixed(0)}%  avg groundedness=${avgGroundedness}/5`
    );
  }

  const allTool = results.filter((r) => r.toolScore.pass).length / results.length;
  const allRagSim = results.flatMap((r) => r.relevanceScore.ragSimilarities);
  const allWebScore = results.flatMap((r) => r.relevanceScore.webScores);
  const totalEmptyTurns = results.reduce((sum, r) => sum + r.relevanceScore.emptyResultTurns, 0);
  const allGroundedness = results.map((r) => r.groundedness.score).filter((s): s is number => s !== null);

  console.log('\n--- overall ---');
  console.log(`planner loop ran: ${results.length - fallbackCount}/${results.length} (fallback ran on the rest)`);
  console.log(`tool-selection pass rate: ${(allTool * 100).toFixed(0)}%`);
  console.log(`mean RAG similarity (kept results): ${formatMean(allRagSim)}`);
  console.log(`mean web relevance score (kept results): ${formatMean(allWebScore)}`);
  console.log(`empty-result tool calls (whiffs): ${totalEmptyTurns}`);
  console.log(`mean groundedness: ${formatMean(allGroundedness)}/5 (n=${allGroundedness.length}/${results.length} judged)`);
}

function formatMean(values: number[]): string {
  if (values.length === 0) return 'n/a';
  return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3);
}

function writeJsonReport(results: unknown[]) {
  const dir = join(__dirname, 'eval-results');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(path, JSON.stringify(results, null, 2));
  console.log(`\n[eval] full report written to ${path}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[eval] harness failed:', error);
    process.exit(1);
  });
