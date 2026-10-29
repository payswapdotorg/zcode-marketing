/**
 * Workspace panel contract tests (W3-4, review Priority 3).
 *
 * Verifies the plugin-side half of the office-panel convention:
 *  - every tool declares its UI routing (`_meta.ui`): panel-routed tools carry
 *    resourceUri + surface + visibility [model, app]; data-only tools stay
 *    model-visible only;
 *  - the panel resource is served as `ui://marketing/panel.html` with the
 *    mcp-app HTML mime type;
 *  - the BUILT panel artifact (dist/panel.html) is a self-contained page:
 *    single script tag, escaped internals, inside the resource budget.
 *
 * The browser-level experience (connect → render → drive) is verified by
 * scripts/w3-4-panel-e2e.mjs (real server + real Chromium + MCP Apps bridge),
 * which produced docs/marketing/evidence/2026-10-29-w3-4-panel-e2e.txt.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketingServer, PANEL_MIME, PANEL_URI } from '../src/server.js';
import { MARKETING_PANEL_TOOLS } from '../src/contract.js';
import { MarketingRuntime } from '../src/runtime.js';

const here = fileURLToPath(new URL('.', import.meta.url));

describe('marketing workspace panel (W3-4)', () => {
  it('routes exactly the declared tool set to the panel surface', async () => {
    const runtime = new MarketingRuntime(here);
    const server = createMarketingServer(runtime, { panelHtml: async () => '<!doctype html><html></html>' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'panel-meta-test', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      const byName = new Map(tools.map((tool) => [tool.name, tool._meta?.ui]));
      // Every panel-routed tool carries the surface descriptor.
      for (const name of MARKETING_PANEL_TOOLS) {
        expect(byName.get(name), `${name} meta`).toEqual({
          resourceUri: PANEL_URI,
          surface: 'marketing',
          visibility: ['model', 'app'],
        });
      }
      // Data-only tools render no page: model visibility only.
      for (const tool of tools) {
        if ((MARKETING_PANEL_TOOLS as readonly string[]).includes(tool.name)) continue;
        expect(tool._meta?.ui, `${tool.name} stays data-only`).toEqual({ visibility: ['model'] });
      }
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
    }
  });

  it('serves the panel as a ui:// mcp-app HTML resource', async () => {
    const runtime = new MarketingRuntime(here);
    const sentinel = '<!doctype html><html><body>marketing panel fixture</body></html>';
    const server = createMarketingServer(runtime, { panelHtml: async () => sentinel });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'panel-resource-test', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const resource = await client.readResource({ uri: PANEL_URI });
      expect(resource.contents[0].mimeType).toBe(PANEL_MIME);
      expect(resource.contents[0].text).toBe(sentinel);
      // Unknown ui:// resources are rejected, not guessed.
      await expect(client.readResource({ uri: 'ui://marketing/nope.html' })).rejects.toThrow();
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
    }
  });

  it('ships a self-contained built panel.html inside the resource budget', async () => {
    // Repo convention (W3-1 evidence note): plugin dists are built before tests
    // (turbo test dependsOn build). Read the real artifact, never a stand-in.
    const dist = join(here, '..', 'dist', 'panel.html');
    let html: string;
    try {
      html = await readFile(dist, 'utf8');
    } catch {
      throw new Error(`dist/panel.html is missing — run pnpm build in marketing-plugin first`);
    }
    // Office smoke conventions: one script tag, real shell, budget honored.
    expect(html).toContain('<div id="root">');
    expect(html.match(/<\/script/gi)?.length).toBe(1);
    expect(Buffer.byteLength(html)).toBeLessThan(4 * 1024 * 1024);
    // Self-contained: no external script/font/network references.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
  });
});
