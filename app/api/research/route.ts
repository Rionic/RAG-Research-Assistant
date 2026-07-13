import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { ResearchSession, StartResearchRequest } from '@/types';
import { getOpenAI, performResearch } from '@/lib/research';

export async function POST(request: NextRequest) {
  try {
    const body: StartResearchRequest = await request.json();
    const { prompt, timezone } = body;

    const userId = request.headers.get('x-user-id');
    const userEmail = request.headers.get('x-user-email');

    // Input & Auth validation
    if (!userId || !userEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Research prompt is required' }, { status: 400 });
    }

    // Admin Firebase SDK for DB R/W
    const sessionRef = adminDb.collection('research_sessions').doc();
    const sessionId = sessionRef.id;

    // GPT-4o generates refinement questions
    const refinementQuestions = await getRefinementQuestions(prompt);

    // Case 1: No refinement questions
    if (refinementQuestions.length === 0) {
      // Context gathering (RAG + web) now happens inside performResearch via
      // the ReAct planner loop — the route just persists the session and
      // returns immediately. webSources/plannerTrace are written mid-run.
      // No refinedPrompt here — with no refinement questions it would just duplicate initialPrompt
      const session: ResearchSession = {
        id: sessionId,
        userId,
        userEmail,
        userTimezone: timezone,
        initialPrompt: prompt,
        refinementQuestions: [],
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Update firestore with new session data
      await sessionRef.set(session);
      // Fire without await. Research runs in background while API returns immediately
      performResearch(sessionId, prompt);

      // Return to frontend to display processing UI
      return NextResponse.json({
        sessionId,
        status: 'processing',
        refinementQuestions: [],
      });
    }
    // Case 2: Refinement questions
    const session: ResearchSession = {
      id: sessionId,
      userId,
      userEmail,
      userTimezone: timezone,
      initialPrompt: prompt,
      refinementQuestions,
      status: 'refining',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Update firestore with new session data
    await sessionRef.set(session);

    // Return to frontend to display refinement questions
    return NextResponse.json({
      sessionId,
      status: 'refining',
      refinementQuestions,
    });
  } catch (error: any) {
    console.error('Error starting research:', error);
    return NextResponse.json({
      error: 'Failed to start research session',
      details: error?.message
    }, { status: 500 });
  }
}

// Initiates call to Groq for refinement questions (or no questions, if prompt is specific)
// Original: model: 'gpt-4o' via OpenAI
async function getRefinementQuestions(prompt: string) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a research assistant. Analyze the user\'s research prompt and determine if you need clarifying questions. If the prompt is already clear and specific, respond with "NO_REFINEMENT_NEEDED". Otherwise, ask 2-3 concise clarifying questions to refine the research scope. Format each question on a new line starting with a number (e.g., "1. Question here").',
        },
        {
          role: 'user',
          content: `Research prompt: ${prompt}\n\nDo you need clarifying questions, or is this prompt clear enough to proceed?`,
        },
      ],
    });

    const response = completion.choices[0].message.content || '';

    if (response.includes('NO_REFINEMENT_NEEDED')) {
      return [];
    }
    // Parses refinement questions by splitting on \n, filtering by '1.' or '1)'
    // and creating an object of {id, question} pairs
    const questionLines = response
      .split('\n')
      .filter(line => line.trim().length > 0 && /^\d+[.)]\s+/.test(line.trim()));

    return questionLines.map((line, index) => ({
      id: `q${index + 1}`,
      question: line.replace(/^\d+[.)]\s+/, '').trim(),
    }));
  } catch (error: any) {
    // Return nothing on error
    console.error('Error getting refinement questions:', error.message);
    return [];
  }
}

