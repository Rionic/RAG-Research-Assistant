# Multi-API Deep Research Assistant with RAG

A full-stack web application featuring a **Retrieval-Augmented Generation (RAG) pipeline** that performs deep research using both OpenAI and Google Gemini APIs. The system learns from previous research sessions to provide increasingly relevant and context-aware results, delivering comprehensive PDF reports via email.

> **Note:** The live deployment uses [Groq](https://groq.com/) (Llama 3.3 70B + GPT-OSS 20B) in place of OpenAI GPT-4o and Google Gemini to avoid API costs. The original OpenAI and Gemini code is preserved in comments in `lib/research.ts` and `app/api/research/route.ts`. (Llama 3.1 8B Instant was swapped for GPT-OSS 20B after Groq deprecated it in June 2026, ahead of its August 16, 2026 decommission.)

## 🌐 Live Demo

**Deployed Application**: [https://research-assistant-7c0m.onrender.com/dashboard](https://research-assistant-7c0m.onrender.com/dashboard)

Try it out with Google OAuth authentication!

## 🎥 Demo Video

[![Watch Demo](https://img.youtube.com/vi/FUheh4Q1hdk/maxresdefault.jpg)](https://www.youtube.com/watch?v=FUheh4Q1hdk)

*Watch the full workflow: authentication, research submission, RAG-enhanced queries, refinement questions, and email delivery with PDF reports.*

## 🎯 Overview

This application allows authenticated users to:
- Submit research queries with interactive refinement using OpenAI
- Leverage RAG to enhance queries with context from previous research sessions
- Execute parallel research with both OpenAI (gpt-4o) and Google Gemini
- Receive professional PDF reports via email with results from both APIs
- Track research history with real-time status updates

### RAG Pipeline Highlights
- **Vector Database**: Qdrant Cloud for semantic similarity search
- **Local Embeddings**: Xenova/all-MiniLM-L6-v2 transformer model (no external API calls)
- **Smart Chunking**: 800-character chunks with 100-character overlap for context preservation
- **User-Scoped Retrieval**: Each user's research history is isolated and searchable
- **Similarity Threshold**: Only retrieves context with ≥60% semantic similarity

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes (serverless)
- **Database**: Firebase Firestore
- **Vector Database**: Qdrant Cloud (for RAG pipeline)
- **Authentication**: Firebase Auth (Google OAuth)
- **APIs**: OpenAI (gpt-4o), Google Gemini (gemini-2.0-flash-exp with deep research)
- **Embeddings**: Xenova/all-MiniLM-L6-v2 (local transformer model)
- **Email**: SendGrid
- **PDF Generation**: jsPDF + marked (markdown parsing)

### Key Features
- **OAuth Authentication**: Secure Gmail sign-in with Firebase Auth
- **Interactive Refinement**: OpenAI analyzes prompts and asks clarifying questions
- **RAG Pipeline**: Retrieval-Augmented Generation using past research to enhance new queries
- **Deep Research**: Gemini 2.0 deep research agent for comprehensive multi-angle analysis
- **Parallel Execution**: Runs OpenAI and Gemini simultaneously for faster results
- **Real-time Updates**: Firestore listeners for instant status updates
- **Professional Reports**: Well-formatted PDFs with tables, lists, and proper typography
- **Email Delivery**: Automatic email with PDF attachment and summary

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Firebase project with Firestore and Authentication enabled
- OpenAI API key with access to `gpt-4o`
- Google Gemini API key
- SendGrid account with verified sender email
- Qdrant Cloud account (free tier available)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Rionic/research-assistant.git
   cd research-assistant
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```

4. **Configure `.env.local`** (see [Environment Setup](#environment-setup) below)

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open [http://localhost:3000](http://localhost:3000)**

## 🔧 Environment Setup

### Firebase Setup

1. **Create Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project
   - Enable Google Authentication (Authentication > Sign-in method > Google)
   - Create Firestore database (Firestore Database > Create database)

2. **Get Firebase Client Credentials**
   - Project Settings > General > Your apps > Web app
   - Copy the config values to `.env.local`:
     ```env
     NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
     NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
     NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
     NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
     NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
     NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
     ```

3. **Get Firebase Admin Credentials**
   - Project Settings > Service Accounts > Generate New Private Key
   - Download the JSON file and extract these values to `.env.local`:
     ```env
     FIREBASE_ADMIN_PROJECT_ID=your-project-id
     FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
     FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour_key_here\n-----END PRIVATE KEY-----\n"
     ```

4. **Create Firestore Index**
   - When you first create a research, Firestore will show an error with a link
   - Click the link to auto-generate the required composite index
   - Index fields: `userId` (ascending), `createdAt` (descending)

### OpenAI Setup

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create an API key
3. Ensure your account has access to `gpt-4o` model
4. Add to `.env.local`:
   ```env
   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxx
   ```

### Google Gemini Setup

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create an API key
3. Add to `.env.local`:
   ```env
   GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

### SendGrid Setup

1. Go to [SendGrid](https://sendgrid.com/)
2. Create an account and verify your sender email
3. Create an API key (Settings > API Keys)
4. Add to `.env.local`:
   ```env
   SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxx
   SENDGRID_FROM_EMAIL=your-verified-email@example.com
   SENDGRID_FROM_NAME=Research Assistant
   ```

### Qdrant Cloud Setup (RAG Pipeline)

1. Go to [Qdrant Cloud](https://cloud.qdrant.io/)
2. Create a free cluster
3. Get your cluster URL and API key from the dashboard
4. Add to `.env.local`:
   ```env
   QDRANT_URL=https://your-cluster-id.region.cloud.qdrant.io
   QDRANT_API_KEY=your-qdrant-api-key
   ```

The RAG pipeline automatically:
- Chunks and embeds research results after each session
- Retrieves similar past research when starting new queries
- Augments prompts with relevant context (similarity threshold: 0.6)

## 📱 Usage

1. **Sign In**
   - Click "Sign in with Google" on the homepage
   - Authenticate with your Gmail account

2. **Create Research**
   - Click "+ New Research" button
   - Enter your research question or topic
   - Submit and wait for AI analysis

3. **Answer Refinement Questions** (if any)
   - OpenAI may ask 2-3 clarifying questions
   - Answer each question to refine your research
   - Click "Submit & Continue Research" when done

4. **Wait for Results**
   - Both OpenAI and Gemini will research in parallel
   - Watch real-time status updates on your dashboard
   - Typical research takes 20-60 seconds

5. **Receive Email**
   - Check your Gmail for the PDF report
   - Email includes a summary and full PDF attachment
   - PDF contains results from both APIs with professional formatting

## 🏛️ Project Structure

```
research-assistant/
├── app/
│   ├── api/
│   │   ├── research/route.ts      # Start research & get refinement questions
│   │   ├── refinement/route.ts    # Submit answers & trigger parallel execution
│   │   └── results/route.ts       # Fetch research results by session ID
│   ├── dashboard/
│   │   └── page.tsx               # Main dashboard with research history
│   ├── layout.tsx                 # Root layout with AuthProvider
│   └── page.tsx                   # Login page with Google OAuth
├── components/
│   └── NewResearchModal.tsx       # Multi-step research creation modal
├── contexts/
│   └── AuthContext.tsx            # Firebase authentication state
├── lib/
│   ├── firebase.ts                # Firebase client SDK configuration
│   ├── firebase-admin.ts          # Firebase Admin SDK (server-side)
│   ├── research.ts                # Shared research logic (OpenAI, Gemini, orchestration)
│   ├── email-sender.ts            # SendGrid email delivery
│   ├── pdf-generator.ts           # jsPDF report generation with markdown
│   └── rag/                       # RAG pipeline
│       ├── index.ts               # Main exports: embedResearchResults, retrieveContext, augmentPrompt
│       ├── chunker.ts             # Text chunking with overlap
│       ├── embeddings.ts          # Local embedding generation (Xenova/all-MiniLM-L6-v2)
│       └── qdrant.ts              # Qdrant vector database operations
├── scripts/
│   └── test-flow.ts               # Backend integration test suite
├── types/
│   └── index.ts                   # TypeScript type definitions
├── public/                        # Static assets
├── .env.example                   # Environment variables template
└── render.yaml                    # Render deployment configuration
```

## 🔒 Security Notes

- Never commit `.env.local` to git (already in `.gitignore`)
- Firebase Admin private key must be kept secret
- All API keys should be rotated regularly
- Client-side Firebase config is safe to expose (uses Firebase Security Rules)

## 🎨 Design Decisions

### Why This Architecture?
- **Client-Server Separation**: Frontend handles UI/UX, backend handles API orchestration
- **Real-time Updates**: Firestore listeners provide instant feedback without polling
- **Parallel Execution**: Promise.all executes both APIs simultaneously for speed
- **Markdown Parsing**: Using `marked` library for robust PDF formatting (tables, lists, etc.)

### Why RAG?
- **Context-Aware Research**: Each new query benefits from insights discovered in previous sessions
- **Local Embeddings**: Using Xenova transformers avoids external API costs and latency for embeddings
- **User Isolation**: Vector search is scoped per-user, ensuring privacy and relevance
- **Graceful Degradation**: RAG failures don't block research - the system continues without context
- **Async Embedding**: Results are embedded in the background, not blocking PDF/email delivery

### API Orchestration Flow
```
User Input → OpenAI Refinement → RAG Context Retrieval → Augment Prompt
                                         ↓
                                   Firestore Save → Parallel Deep Research
                                                     ├─ OpenAI (gpt-4o)
                                                     └─ Gemini (2.0 deep research)
                                                           ↓
                                                     PDF Generation → Email → Update Firestore
                                                           ↓
                                                     Embed Results → Store in Qdrant (async)
```

### RAG Pipeline Flow
```
New Query → Generate Embedding → Search Qdrant (user-scoped) → Filter by Similarity (≥0.6)
                                                                        ↓
                                                              Augment Prompt with Context
                                                                        ↓
                                                              Enhanced Research Results
```

## 🧪 Testing

Run the backend test suite:
```bash
npm run test:flow
```

This tests all API integrations and components (OpenAI, Gemini, PDF generation, email sending).

## 📊 Firestore Schema

### Collection: `research_sessions`
```typescript
{
  id: string;
  userId: string;
  userEmail: string;
  initialPrompt: string;
  refinedPrompt?: string;
  status: 'refining' | 'processing' | 'completed' | 'email_sent' | 'failed';
  refinementQuestions: Array<{
    question: string;
    answer?: string;
  }>;
  openaiResult?: string;
  geminiResult?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}
```
