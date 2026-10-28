/**
 * Marketing plugin MCP server entry — started by the plugin host through the
 * stdio transport declared in .zcode-plugin/plugin.json.
 *
 * The server process owns no planner loop and no session state: it exposes the
 * marketing mission tools, persists mission state under the workspace
 * (.zcode/marketing/), and leaves every decision to the ZCode runtime that
 * calls it (MARKETING-ARCHITECTURE-LOCK.md).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MarketingRuntime } from './runtime.js';
import { createMarketingServer } from './server.js';

export async function main(): Promise<void> {
  const workspace = process.env.ZCODE_WORKSPACE_ROOT || process.cwd();
  const runtime = new MarketingRuntime(workspace);
  const server = createMarketingServer(runtime);

  let stopping = false;
  async function close(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await runtime.close().catch((error: unknown) => {
      process.stderr.write(`marketing runtime close: ${String(error)}\n`);
    });
    await server.close();
  }
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  process.stdin.once('end', () => void close());
  await server.connect(new StdioServerTransport());
}

// Standalone Node process entry (also used by the W3 chain verification script).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`marketing server failed to start: ${String(error)}\n`);
    process.exit(1);
  });
}
