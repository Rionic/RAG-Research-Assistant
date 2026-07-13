export interface User {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Date;
}

export type ResearchStatus =
  | 'refining'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'email_sent';

// Structure of refinement question returned from GPT-4o
export interface RefinementQuestion {
  id: string;
  question: string;
  answer?: string;
}

// A web source surfaced by the web search tool, used to ground research and cite sources
export interface WebSource {
  title: string;
  url: string;
}

// One step of the ReAct planner loop, persisted for observability and the
// future eval harness. All optional slots are null (never undefined —
// Firestore rejects undefined values).
export interface PlannerTraceStep {
  step: number;
  thought: string | null;      // assistant text alongside/instead of tool calls
  toolName: string | null;     // null on the concluding step
  arguments: Record<string, unknown> | null;
  observation: string | null;  // truncated to keep the session doc small
  isError: boolean;
  durationMs: number;
}

// Research session with all related metadata
export interface ResearchSession {
  id: string;
  userId: string;
  userEmail: string;
  userTimezone?: string;
  initialPrompt: string;
  refinedPrompt?: string;
  refinementQuestions: RefinementQuestion[];
  webSources?: WebSource[];
  plannerTrace?: PlannerTraceStep[];
  openaiResult?: string;
  geminiResult?: string;
  status: ResearchStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  pdfUrl?: string;
  emailSentAt?: Date;
  error?: string;
}

// Prompt + timezone to capture when research started, used by research route
export interface StartResearchRequest {
  prompt: string;
  timezone?: string;
}


export interface SubmitRefinementRequest {
  sessionId: string;
  questionId: string;
  answer: string;
}

