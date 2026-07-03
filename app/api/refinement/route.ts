import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { ResearchSession, SubmitRefinementRequest, WebSource } from '@/types';
import { performResearch } from '@/lib/research';
import { retrieveContext } from '@/lib/rag';
import { augmentPromptWithPastResearch, augmentPromptWithWebSources } from '@/lib/prompts';
import { webSearch } from '@/lib/tools/webSearch';

export async function POST(request: NextRequest) {
  try {
    const body: SubmitRefinementRequest = await request.json();
    const { sessionId, questionId, answer } = body;
    // Input validation
    if (!sessionId || !questionId || !answer) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Admin Firebase SDK for DB R/W
    const sessionRef = adminDb.collection('research_sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return NextResponse.json({ error: 'Research session not found' }, { status: 404 });
    }

    const session = sessionDoc.data() as ResearchSession;

    // Update the answered question in the array, leaving all others unchanged
    const updatedQuestions = session.refinementQuestions.map(q =>
      q.id === questionId ? { ...q, answer } : q
    );

    // Write refinement questions in existing firestore document
    await sessionRef.update({
      refinementQuestions: updatedQuestions,
      updatedAt: new Date(),
    });

    const allAnswered = updatedQuestions.every(q => q.answer);

    // Case 2.1: All questions answered
    if (allAnswered) {
      const questionsAndAnswers = updatedQuestions
        .map(q => `Q: ${q.question}\nA: ${q.answer}`)
        .join('\n\n');

      // Construct additional context for LLMs from refinement question answers
      const refinedPrompt = `${session.initialPrompt}\n\nAdditional context:\n${questionsAndAnswers}`;

      // Augmented context (RAG + web) is LLM input only — never persisted,
      // so reports/embeddings don't get polluted with raw source dumps
      let researchPrompt = refinedPrompt;
      try {
        // RAG retrieval & augment entry points
        const ragContext = await retrieveContext(session.initialPrompt, session.userId);
        if (ragContext.relevantResults.length > 0) {
          researchPrompt = augmentPromptWithPastResearch(researchPrompt, ragContext);
          console.log(`Augmented prompt with ${ragContext.relevantResults.length} RAG results`);
        } else {
          console.log('No RAG results retrieved (no similar past research or below similarity threshold)');
        }
      } catch (error) {
        console.error('RAG retrieval failed, continuing without context:', error);
      }

      // Web search entry point: Grounds research in live sources instead of model-only knowledge
      let webSources: WebSource[] = [];
      try {
        const { results } = await webSearch(session.initialPrompt);
        if (results.length > 0) {
          researchPrompt = augmentPromptWithWebSources(researchPrompt, results);
          webSources = results.map(r => ({ title: r.title, url: r.url }));
          console.log(`Augmented prompt with ${results.length} web search results`);
        }
      } catch (error) {
        console.error('Web search failed, continuing without it:', error);
      }

      // Update firestore with refined prompt
      await sessionRef.update({
        refinedPrompt,
        webSources,
        status: 'processing',
        updatedAt: new Date(),
      });
      // Fire without await. Research runs in background while API returns immediately
      performResearch(sessionId, researchPrompt);
      
      // Return to frontend to display processing UI
      return NextResponse.json({
        sessionId,
        status: 'processing',
        refinedPrompt,
      });
    } else {
      // Case 2.2: We have unanswered questions
      const nextQuestion = updatedQuestions.find(q => !q.answer);
      
      // Return next unanswered question to frontend
      return NextResponse.json({
        sessionId,
        status: 'refining',
        nextQuestion,
      });
    }
  } catch (error) {
    console.error('Error submitting refinement:', error);
    return NextResponse.json({ error: 'Failed to submit refinement' }, { status: 500 });
  }
}
