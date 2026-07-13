// In-process MCP client: connects an SDK Client to the app's own McpServer
// over a linked in-memory transport pair. This is how the ReAct planner
// consumes tools — over real MCP, not direct function imports — with zero
// network overhead.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '@/lib/mcp/tools';

// Cache the promise (not the resolved client) so concurrent first callers
// share one connection; reset on rejection so a transient failure can retry.
let clientPromise: Promise<Client> | null = null;

export function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = new McpServer({ name: 'research-assistant', version: '0.1.0' });
  registerTools(server);
  await server.connect(serverTransport);

  const client = new Client({ name: 'research-assistant-planner', version: '0.1.0' });
  await client.connect(clientTransport);
  return client;
}
