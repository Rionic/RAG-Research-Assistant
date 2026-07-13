// Stdio entry for the research-assistant MCP server (local dev / Claude Code via .mcp.json).
// stdout is the JSON-RPC channel, lib code logs with console.log (e.g. lib/rag/index.ts),
// so redirect it to stderr before anything else loads.
console.log = console.error;

import { config } from 'dotenv';
// Next.js loads .env.local automatically; outside Next we do it ourselves (first match wins)
config({ path: ['.env.local', '.env'] });

async function main() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  // Import tools after env is loaded. lib/email-sender.ts reads SENDGRID_API_KEY at import time
  const { registerTools } = await import('../lib/mcp/tools');

  const server = new McpServer({ name: 'research-assistant', version: '0.1.0' });
  registerTools(server);
  await server.connect(new StdioServerTransport());
  console.error('research-assistant MCP server running on stdio');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
