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

  // W3-2: bind a lazily-checked sampling client. server.connect() resolves
  // before the client's initialize handshake arrives, so the capability is
  // checked PER CALL, not at a fixed startup point. A host that never declared
  // `sampling` fails the check, the error reaches FallbackModelPort, and the
  // labeled heuristic adapter runs with the reason stamped into provenance —
  // visible, never silent. Structured extraction that DOES go through routes
  // to the host's provider system (`zcode:routed:<model>` provenance).
  runtime.setSamplingClient({
    createMessage: async (request) => {
      const capabilities = server.server.getClientCapabilities();
      if (!capabilities?.sampling) {
        throw new Error('host did not declare the sampling capability');
      }
      const result = await server.server.createMessage({
        messages: request.messages,
        ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
        maxTokens: request.maxTokens,
        ...(request.modelPreferences !== undefined ? { modelPreferences: request.modelPreferences } : {}),
      });
      return {
        role: 'assistant',
        model: result.model,
        content:
          result.content.type === 'text'
            ? { type: 'text', text: result.content.text }
            : { type: 'text', text: JSON.stringify(result.content) },
        stopReason: result.stopReason ?? 'unknown',
      };
    },
  });
}

// Standalone Node process entry (also used by the W3 chain verification script).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`marketing server failed to start: ${String(error)}\n`);
    process.exit(1);
  });
}
