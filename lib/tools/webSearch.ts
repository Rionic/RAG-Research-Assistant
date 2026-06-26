// Web search tool — wraps Tavily's search API.
// Exposed as a standalone function so a future agent/ReAct loop can call it
// as a discrete "tool" alongside RAG retrieval.

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

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

  const results: WebSearchResult[] = (data.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || '',
  }));

  return { results };
}
