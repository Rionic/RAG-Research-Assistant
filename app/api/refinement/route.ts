import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { ResearchSession, SubmitRefinementRequest } from '@/types';
import { performResearch } from '@/lib/research';

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

      // Context gathering (RAG + web) now happens inside performResearch via
      // the ReAct planner loop, which sees the full refined prompt (the old
      // fixed sequence searched against initialPrompt only)
      await sessionRef.update({
        refinedPrompt,
        status: 'processing',
        updatedAt: new Date(),
      });
      // Fire without await. Research runs in background while API returns immediately
      performResearch(sessionId, refinedPrompt);
      
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
