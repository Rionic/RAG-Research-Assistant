# Summer 2026 Updates

## Web Search (shipped)

Research requests are no longer grounded purely in model knowledge — they now pull live web results via [Tavily](https://tavily.com).

**How it works:**

1. User submits a research prompt → `app/api/research/route.ts` (or `app/api/refinement/route.ts` once clarifying questions are answered).
2. Before calling the LLMs, the route runs two context-gathering steps in parallel-by-intent (not literally `Promise.all`, but both fire before generation):
   - RAG retrieval (`retrieveContext`) — pulls relevant chunks from the user's own past research sessions, stored in Qdrant.
   - Web search (`webSearch` in `lib/tools/webSearch.ts`) — hits the Tavily API for ~5 live results (title, URL, content snippet) for the prompt.
3. Both sets of context are stitched into the prompt:
   - `augmentPrompt` (RAG) and `augmentPromptWithWebSearch` (web) in `lib/rag/index.ts`.
   - The web-search augmentation explicitly instructs the model to ground its answer in the provided sources and cite them by URL.
4. The augmented prompt is sent to both Groq research calls (`llama-3.3-70b-versatile` and `openai/gpt-oss-20b`) in `lib/research.ts`, same parallel-execution pattern as before.
5. The raw source list (`title`, `url`) is saved on the session as `webSources` (`types/index.ts`) and rendered in:
   - The PDF report (`lib/pdf-generator.ts`) — "Web Sources" section.
   - The email (`lib/email-sender.ts`) — "🌐 Web Sources" section with links.
6. Failure mode: if Tavily errors or `TAVILY_API_KEY` isn't set, the route logs and continues without web context — same graceful-degradation pattern as RAG. Research still completes either way.

**Why this mattered:** the Groq-hosted models (`llama-3.3-70b-versatile`, `openai/gpt-oss-20b`) don't browse the web on their own — they're plain chat-completion models. Before this change, the "sources and citations" in research output were the model's best guess from training data, not verified live information. This closes that gap.

**Setup:** requires `TAVILY_API_KEY` in environment (free tier at app.tavily.com). Set locally in `.env.local` and in Render's environment variables for production.

## Also shipped this round

- Swapped deprecated Groq model `llama-3.1-8b-instant` → `openai/gpt-oss-20b` (Groq's recommended replacement) ahead of the 2026-08-16 decommission date.

## Planned next

The long-term goal: evolve from a fixed research pipeline into something genuinely agentic, using MCP as the connective tissue.

1. **Wrap existing capabilities as MCP tools** — web search, RAG retrieval, PDF/email generation — behind a small MCP server, so they're callable as discrete tools rather than hardcoded function calls. This is the main differentiator: "exposed retrieval and generation as MCP tools" vs. "called an API directly."
2. **ReAct planner loop** — replace the current fixed sequence (always RAG + always web search + always both LLMs) with a loop where the model decides at each step whether to retrieve from memory, search the web, ask a clarifying question, or conclude. Now meaningful since there are real tools with different tradeoffs to choose between.
3. **Eval harness** — small fixed set of test queries (20-30) scored on tool-selection accuracy, retrieval relevance, and groundedness (now checkable against real web sources instead of model-only claims).
4. **Optional stretch:** richer cross-session memory in Firestore; multi-agent split (researcher/writer) — lower priority, only if there's time/interest.
