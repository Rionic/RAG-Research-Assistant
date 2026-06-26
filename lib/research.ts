import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { adminDb } from '@/lib/firebase-admin';
import { ResearchSession } from '@/types';
import { embedResearchResults } from '@/lib/rag';

// Original OpenAI client (GPT-4o) — kept for reference
// export function getOpenAI() {
//   return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// }

// Groq client using OpenAI-compatible SDK (free tier)
export function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.GROQ_API_KEY || '',
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

export function getGeminiAI() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || ''
  });
}

export async function performResearch(sessionId: string, refinedPrompt: string) {
  const sessionRef = adminDb.collection('research_sessions').doc(sessionId);

  try {
    console.log('Starting research for session:', sessionId);

    const [openaiResult, geminiResult] = await Promise.all([
      performOpenAIResearch(refinedPrompt),
      performGeminiResearch(refinedPrompt),
    ]);

    // Research complete
    await sessionRef.update({
      openaiResult,
      geminiResult,
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    const sessionDoc = await sessionRef.get();
    const session = sessionDoc.data() as ResearchSession;

    // Embedding entry point
    embedResearchResults(session).catch(err =>
      console.error('Background embedding failed:', err)
    );

    console.log('Generating PDF and sending email with both results...');

    await generateAndEmailReport(session);
    
    // Email sent
    await sessionRef.update({
      status: 'email_sent',
      emailSentAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('Research completed successfully for session:', sessionId);
  } catch (error) {
    console.error('Error in performResearch:', error);

    try {
      await sessionRef.update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date(),
      });
    } catch (updateError) {
      console.error('Failed to update error status:', updateError);
    }
  }
}

async function performOpenAIResearch(prompt: string): Promise<string> {

  // Original: OpenAI GPT-4o
  // console.log('Starting OpenAI deep research agent...');
  // const completion = await getOpenAI().chat.completions.create({
  //   model: 'gpt-4o',
  //   messages: [
  //     {
  //       role: 'system',
  //       content: 'You are a thorough research assistant. Provide comprehensive, well-structured research findings with sources and citations. Include specific data points, trends, and actionable insights.',
  //     },
  //     {
  //       role: 'user',
  //       content: prompt,
  //     },
  //   ],
  //   temperature: 0.7,
  //   max_tokens: 3000,
  // });
  // return completion.choices[0].message.content || '';

  console.log('Starting Groq research agent...');

  const completion = await getOpenAI().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a thorough research assistant. Provide comprehensive, well-structured research findings with sources and citations. Include specific data points, trends, and actionable insights.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 3000,
  });

  return completion.choices[0].message.content || '';
}

async function performGeminiResearch(prompt: string): Promise<string> {
  try {
    // Original: Gemini deep-research-pro-preview (paid, async polling agent)
    // const gemini = getGeminiAI();
    // console.log('Starting Gemini deep research agent...');
    // const interaction = await gemini.interactions.create({
    //   input: prompt,
    //   agent: 'deep-research-pro-preview-12-2025',
    //   background: true,
    // });
    // console.log('Gemini deep research interaction created:', interaction.id);
    // console.log('Waiting for deep research to complete...');
    // let completedInteraction = interaction;
    // let pollCount = 0;
    // const maxPolls = 120;
    // while (pollCount < maxPolls) {
    //   completedInteraction = await gemini.interactions.get(interaction.id);
    //   console.log(`Polling attempt ${pollCount + 1}, status: ${completedInteraction.status || 'unknown'}`);
    //   if (completedInteraction.status === 'failed' || completedInteraction.status === 'cancelled') {
    //     console.error('Deep research failed or was cancelled');
    //     break;
    //   }
    //   if (completedInteraction.status === 'in_progress' || completedInteraction.status === 'requires_action') {
    //     await new Promise(resolve => setTimeout(resolve, 5000));
    //     pollCount++;
    //     continue;
    //   }
    //   console.log('Deep research completed!');
    //   break;
    // }
    // if (pollCount >= maxPolls) console.warn('Deep research timed out after polling');
    // let result = '';
    // if (completedInteraction.outputs && completedInteraction.outputs.length > 0) {
    //   const lastOutput = completedInteraction.outputs[completedInteraction.outputs.length - 1];
    //   if ('text' in lastOutput) result = lastOutput.text || '';
    // }
    // return result || 'No response from Gemini deep research agent';

    // Swapped to Gemini 2.0 Flash (free tier) — also quota issues, using Groq mixtral instead
    // const response = await gemini.models.generateContent({
    //   model: 'gemini-2.0-flash',
    //   contents: [{ role: 'user', parts: [{ text: `You are a thorough research assistant....\n\n${prompt}` }] }],
    // });

    // llama-3.1-8b-instant deprecated by Groq (decommissioned 2026-08-16); switched to recommended replacement
    console.log('Starting Groq gpt-oss-20b research agent...');

    const completion = await getOpenAI().chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [
        {
          role: 'system',
          content: 'You are a thorough research assistant. Provide comprehensive, well-structured research findings with sources and citations. Include specific data points, trends, and actionable insights.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const result = completion.choices[0].message.content || '';
    console.log('Groq gpt-oss-20b research completed, result length:', result.length);
    return result || 'No response from Groq gpt-oss-20b';
  } catch (error) {
    console.error('Error with Groq gpt-oss-20b research agent:', error);
    throw error;
  }
}

async function generateAndEmailReport(session: ResearchSession) {
  const { sendResearchReport } = await import('@/lib/email-sender');
  await sendResearchReport(session);
}
