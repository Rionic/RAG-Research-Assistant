import { randomUUID } from 'crypto';
import { ResearchSession } from '@/types';
import { generateEmbedding } from './embeddings';
import { chunkText } from './chunker';
import {
  ensureCollection,
  upsertVectors,
  searchSimilar,
  VectorPoint,
  SearchResult,
} from './qdrant';

export interface RAGContext {
  relevantResults: SearchResult[];
}

const TOP_K_DEFAULT = 5;
const SIMILARITY_THRESHOLD = 0.6;

// Index file - top-level file to handle calls for all RAG ops (embed, retrieve)
// Prompt assembly lives in lib/prompts.ts

// Called only once research task is complete, and all research metadata is available
// Throws on failure so callers (MCP tools, fire-and-forget .catch in lib/research.ts)
// can distinguish "nothing to embed" from a real Qdrant/embedding error
export async function embedResearchResults(
  session: ResearchSession
): Promise<{ pointsEmbedded: number }> {
  try {
    // Check that Qdrant collection exists
    await ensureCollection();

    const points: VectorPoint[] = [];

    if (session.openaiResult) {
      // Chunk only the text for semantic meaning capture
      const chunks = chunkText(session.openaiResult);
      for (const chunk of chunks) {
        // Embed each chunk
        const embedding = await generateEmbedding(chunk.text);
        // Each chunk becomes a VectorPoint — vector, chunkText,
        // and chunkIndex differ per chunk, metadata stays consistent
        points.push({
          id: randomUUID(),
          vector: embedding,
          payload: {
            sessionId: session.id,
            userId: session.userId,
            initialPrompt: session.initialPrompt,
            refinedPrompt: session.refinedPrompt,
            source: 'openai',
            chunkIndex: chunk.index,
            chunkText: chunk.text,
            createdAt: new Date().toISOString(),
          },
        });
      }
    }

    // Chunk Gemini result
    if (session.geminiResult) {
      const chunks = chunkText(session.geminiResult);
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.text);
        points.push({
          id: randomUUID(),
          vector: embedding,
          payload: {
            sessionId: session.id,
            userId: session.userId,
            initialPrompt: session.initialPrompt,
            refinedPrompt: session.refinedPrompt,
            source: 'gemini',
            chunkIndex: chunk.index,
            chunkText: chunk.text,
            createdAt: new Date().toISOString(),
          },
        });
      }
    }

    // Upsert vector for safety, in case of a chunk getting re-processed (shouldn't happen)
    if (points.length > 0) {
      await upsertVectors(points);
      console.log(`Embedded ${points.length} chunks for session ${session.id}`);
    }

    return { pointsEmbedded: points.length };
  } catch (error) {
    console.error('Failed to embed research results:', error);
    throw error;
  }
}

// Both retrieved and augment called right before executing OpenAI & Gemini research
// Retrieve top 5 most similar, if anything is found, augment prompt, send to agents
export async function retrieveContext(
  prompt: string,
  userId: string,
  topK: number = TOP_K_DEFAULT
): Promise<RAGContext> {
  try {
    await ensureCollection();
    const queryEmbedding = await generateEmbedding(prompt);
    const results = await searchSimilar(queryEmbedding, userId, topK);
    const filteredResults = results.filter(r => r.similarity >= SIMILARITY_THRESHOLD);

    return { relevantResults: filteredResults };
  } catch (error) {
    console.error('Failed to retrieve RAG context:', error);
    return { relevantResults: [] };
  }
}
