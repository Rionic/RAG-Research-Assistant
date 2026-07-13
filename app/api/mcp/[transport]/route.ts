// Remote MCP server over Streamable HTTP — endpoint: /api/mcp/mcp
// Stateless: mcp-handler builds a fresh McpServer per request (no Redis/SSE),
// which suits Render's single free instance. Tools live in lib/mcp/tools.ts.
import { timingSafeEqual } from 'crypto';
import { createMcpHandler } from 'mcp-handler';
import { registerTools } from '@/lib/mcp/tools';

const handler = createMcpHandler(
  (server) => registerTools(server),
  {
    serverInfo: { name: 'research-assistant', version: '0.1.0' },
  },
  {
    basePath: '/api/mcp',
    maxDuration: 300,
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== 'production',
  }
);

// Static bearer token check. Fails closed if MCP_API_KEY is unset.
// Note: the key grants access to all sessions (single-tenant deployment).
function authorized(req: Request): boolean {
  const key = process.env.MCP_API_KEY;
  if (!key) {
    return false;
  }
  const header = req.headers.get('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function withAuth(h: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (!authorized(req)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json' },
      });
    }
    return h(req);
  };
}

export const GET = withAuth(handler);
export const POST = withAuth(handler);
export const DELETE = withAuth(handler);
