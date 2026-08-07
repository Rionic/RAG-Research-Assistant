// Fixed test set for the planner eval harness (scripts/eval-planner.ts).
// Kept separate from the runner so the fixture is easy to extend independently.
//
// Categories deliberately include two adversarial ones that reproduce real
// incidents caught during manual testing (see personal-notes.md):
//   - 'multi-angle' reproduces the shape that triggered the 8000-TPM Groq
//     rate-limit failure (many broad searches compiling into an oversized prompt)
//   - 'ambiguous' reproduces the "fashion models" pollution incident (a query
//     whose literal words collide with an unrelated, popular topic)

export interface EvalQuery {
  id: string;
  prompt: string;
  category: 'rag-first' | 'web-first' | 'multi-angle' | 'ambiguous';
  expectedTools: ('rag_retrieve' | 'web_search')[]; // tools it should call at least once
  notes?: string;
}

// Read-only rag_retrieve calls use this id so eval runs never touch real user
// memory. Kept distinct even though the harness never calls rag_embed today.
export const EVAL_USER_ID = 'eval-harness-user';

export const EVAL_QUERIES: EvalQuery[] = [
  // --- rag-first: topics this app's own domain, worth checking memory first ---
  {
    id: 'rag-01',
    prompt: 'What have I researched about vector databases and RAG retrieval before?',
    category: 'rag-first',
    expectedTools: ['rag_retrieve'],
    notes: 'Directly asks for past research; should check memory before (or instead of) the web',
  },
  {
    id: 'rag-02',
    prompt: 'Summarize my prior research on the Model Context Protocol ecosystem',
    category: 'rag-first',
    expectedTools: ['rag_retrieve'],
  },
  {
    id: 'rag-03',
    prompt: 'What did I find out about Qdrant and embedding models in past sessions?',
    category: 'rag-first',
    expectedTools: ['rag_retrieve'],
  },
  {
    id: 'rag-04',
    prompt: 'Pull together what I already know about solid-state EV batteries from my research history',
    category: 'rag-first',
    expectedTools: ['rag_retrieve'],
  },
  {
    id: 'rag-05',
    prompt: 'Based on research I have already done, what are the tradeoffs of serverless Postgres?',
    category: 'rag-first',
    expectedTools: ['rag_retrieve'],
  },

  // --- web-first: fresh/current-events style, memory unlikely to help ---
  {
    id: 'web-01',
    prompt: "What is today's weather forecast for Vancouver, Canada?",
    category: 'web-first',
    expectedTools: ['web_search'],
    notes: 'Time-sensitive; RAG memory structurally cannot help here',
  },
  {
    id: 'web-02',
    prompt: 'What were the major tech industry layoffs announced this month?',
    category: 'web-first',
    expectedTools: ['web_search'],
  },
  {
    id: 'web-03',
    prompt: 'What is the current stock price and market cap of Nvidia?',
    category: 'web-first',
    expectedTools: ['web_search'],
  },
  {
    id: 'web-04',
    prompt: 'What version of Node.js was most recently released and what changed?',
    category: 'web-first',
    expectedTools: ['web_search'],
  },
  {
    id: 'web-05',
    prompt: 'Who won the most recent Formula 1 Grand Prix and what was the result?',
    category: 'web-first',
    expectedTools: ['web_search'],
  },
  {
    id: 'web-06',
    prompt: 'What are the latest updates to the TypeScript compiler in its newest release?',
    category: 'web-first',
    expectedTools: ['web_search'],
  },

  // --- multi-angle: several distinct facets in one prompt; should provoke
  // multiple refined searches (this is the shape that caused the TPM incident) ---
  {
    id: 'multi-01',
    prompt:
      'Give a comprehensive overview of the current state of the Model Context Protocol ecosystem in 2026: adoption trends, major implementations, security concerns, and how remote MCP servers are deployed in production.',
    category: 'multi-angle',
    expectedTools: ['web_search'],
    notes: 'Reproduces the exact multi-facet prompt that triggered the original 8000-TPM failure',
  },
  {
    id: 'multi-02',
    prompt:
      'Compare the top TypeScript ORMs for a serverless Postgres setup in 2026, covering performance, type safety, migration tooling, and developer experience.',
    category: 'multi-angle',
    expectedTools: ['web_search'],
  },
  {
    id: 'multi-03',
    prompt:
      'Research the electric vehicle battery technology landscape: solid-state batteries, charging infrastructure, raw material supply chains, and regulatory incentives across major markets.',
    category: 'multi-angle',
    expectedTools: ['web_search'],
  },
  {
    id: 'multi-04',
    prompt:
      'What are the current best practices for LLM agent architectures, including tool-calling patterns, memory systems, evaluation methods, and production deployment concerns?',
    category: 'multi-angle',
    expectedTools: ['web_search'],
  },
  {
    id: 'multi-05',
    prompt:
      'Give a full picture of the current AI coding assistant market: major players, pricing models, feature differentiation, and enterprise adoption patterns.',
    category: 'multi-angle',
    expectedTools: ['web_search'],
  },

  // --- ambiguous: literal query terms collide with an unrelated dominant topic
  // (this is the shape that caused the fashion-model pollution incident) ---
  {
    id: 'ambig-01',
    prompt: 'What is the current state of Model Context Protocol adoption?',
    category: 'ambiguous',
    expectedTools: ['web_search'],
    notes:
      'Near-exact reproduction of the query that returned fashion/modeling sites before the score filter was added',
  },
  {
    id: 'ambig-02',
    prompt: 'How is Java performance trending in 2026?',
    category: 'ambiguous',
    expectedTools: ['web_search'],
    notes: '"Java" collides with the coffee/island/Indonesia sense',
  },
  {
    id: 'ambig-03',
    prompt: 'What are the latest developments with Python in enterprise software?',
    category: 'ambiguous',
    expectedTools: ['web_search'],
    notes: '"Python" collides with the snake/animal sense',
  },
  {
    id: 'ambig-04',
    prompt: 'What is new with Swift for backend development?',
    category: 'ambiguous',
    expectedTools: ['web_search'],
    notes: '"Swift" collides with the musician-name sense, a very high-volume competing topic',
  },
  {
    id: 'ambig-05',
    prompt: 'What are current trends in Rust adoption for systems programming?',
    category: 'ambiguous',
    expectedTools: ['web_search'],
    notes: '"Rust" collides with the corrosion/chemistry sense',
  },
  {
    id: 'ambig-06',
    prompt: 'How is the Go ecosystem evolving for cloud infrastructure?',
    category: 'ambiguous',
    expectedTools: ['web_search'],
    notes: '"Go" collides with the board game and the common verb, both extremely high-volume',
  },
];
