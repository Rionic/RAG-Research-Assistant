// Web search tool — wraps Tavily's search API.
// Exposed as a standalone function so a future agent/ReAct loop can call it
// as a discrete "tool" alongside RAG retrieval.

// jsPDF only supports Latin characters with its built-in fonts.
// Strip non-Latin Unicode from search result text before it reaches the PDF or prompt.
function sanitizeText(text: string): string {
  return text.replace(/[^\x00-\x7FÀ-ɏ]/g, '').trim();
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

// Threshold for web sources to be considered
const MIN_RELEVANCE_SCORE = 0.3;

export interface WebSearchResponse {
  results: WebSearchResult[];
}

export async function webSearch(
  query: string,
  maxResults: number = 5
): Promise<WebSearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error('TAVILY_API_KEY must be set');
  }

  // Tavily rejects queries under 2 chars — skip the round-trip and return no results
  if (query.trim().length < 2) {
    return { results: [] };
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: 'basic',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${body}`);
  }

  const data = await response.json();

  const results: WebSearchResult[] = (data.results || [])
    .map((r: any) => ({
      title: sanitizeText(r.title || ''),
      url: r.url || '',
      content: sanitizeText(r.content || ''),
      score: typeof r.score === 'number' ? r.score : 0,
    }))
    // Drop off-topic results; an empty list tells callers the query whiffed and should be rephrased
    .filter((r: WebSearchResult) => r.score >= MIN_RELEVANCE_SCORE);

  return { results };
}
