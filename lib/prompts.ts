import { RAGContext } from '@/lib/rag';
import { WebSearchResult } from '@/lib/tools/webSearch';

// Prompt assembly - stitches retrieved context (past research, live web sources)
// into the research prompt before it is sent to the LLMs

export function augmentPromptWithPastResearch(originalPrompt: string, context: RAGContext): string {
  if (context.relevantResults.length === 0) {
    return originalPrompt;
  }

  // Gives agent every returned relevant previous research chunk alongside original prompt and similarity score
  const contextSection = context.relevantResults
    .map(
      (r, i) =>
        `[Previous Research ${i + 1}] (Similarity: ${(r.similarity * 100).toFixed(1)}%)\nOriginal Query: ${r.originalPrompt}\nRelevant Finding: ${r.text}`
    )
    .join('\n\n');

  return `${originalPrompt}

---
The following are relevant findings from previous research that may provide helpful context:

${contextSection}

---
Please incorporate any relevant insights from the above context into your research, while focusing primarily on the main research query.`;
}

export function augmentPromptWithWebSources(
  originalPrompt: string,
  results: WebSearchResult[]
): string {
  if (results.length === 0) {
    return originalPrompt;
  }

  const sourcesSection = results
    .map((r, i) => `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join('\n\n');

  return `${originalPrompt}

---
The following are live web search results relevant to this query. Ground your research in these sources and cite them (by URL) where used:

${sourcesSection}

---
Please prioritize factual accuracy from the above sources over prior knowledge, and continue to focus primarily on the main research query.`;
}
