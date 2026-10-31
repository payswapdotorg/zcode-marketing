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
 *
 * WO-P5 (historical intelligence integrity) adds the CI-runnable render
 * assertions: the report-tab renderers are driven directly through a minimal
 * document stub to assert the point-of-use coverage disclosure (AT-P5.4,
 * handoff §11) and the explicit no-observation chip (AT-P5.2, §2 contract) on
 * rendered HTML strings.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketingServer, PANEL_MIME, PANEL_URI } from '../src/server.js';
import { MARKETING_PANEL_TOOLS } from '../src/contract.js';
import { MarketingRuntime } from '../src/runtime.js';
import { S } from '../ui/state.ts';
import { render, setActions } from '../ui/render.ts';
import {
  en,
  zh,
  type CoverageSlice,
  type Evidence,
  type MissionEntry,
  type Opportunity,
  type Report,
  type Signal,
} from '../ui/types.ts';

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

// ---------------------------------------------------------------------------
// WO-P5 — panel disclosure (AT-P5.4 point-of-use coverage, AT-P5.2 explicit
// no-observation). Fixtures mirror the real payload shapes: the keyless
// organic feed (youtube-public-rss) carries a rolling-window dateWindow
// ("last 15 uploads" — no complete historical archive), the Google Ads
// Transparency Center carries reported first→last-shown windows, and signals
// may carry the §2 noObservation contract field when no observation supports
// a value.
// ---------------------------------------------------------------------------

const p5Brief = {
  product: 'portable espresso machine',
  audience: 'outdoor coffee lovers',
  country: 'US',
  platform: 'youtube',
  offer: 'launch bundle',
  objective: 'awareness',
};
const p5Entry: MissionEntry = {
  missionId: 'mission-p5',
  brief: p5Brief,
  researchMode: 'live',
  createdAt: '2026-10-31T00:00:00.000Z',
  competitors: [],
};

const windowedSlices: CoverageSlice[] = [
  {
    slice: 'organic-uploads:AeroPress',
    state: 'available',
    sourceId: 'youtube-public-rss',
    connectorVersion: '1.2.0',
    dateWindow: 'last 15 uploads',
    note: 'keyless uploads RSS resolved for channel UC123; current-snapshot view counts included',
  },
  {
    slice: 'creative-metadata:AeroPress',
    state: 'partial',
    sourceId: 'youtube-public-rss',
    connectorVersion: '1.2.0',
    note: 'oEmbed enrichment sampled (rate-limit friendly)',
  },
  {
    slice: 'paid-ads:AeroPress',
    state: 'available',
    sourceId: 'google-ads-transparency',
    connectorVersion: '1.1.0',
    dateWindow: '2026-09-14→2026-10-28',
    note: 'resolved to verified advertiser; platform-reported first/last shown dates only',
  },
  {
    slice: 'paid-delivery-metrics:google-ads-transparency',
    state: 'unavailable',
    sourceId: 'google-ads-transparency',
    connectorVersion: '1.1.0',
    note: 'impressions/spend/clicks not provided by the public transparency service',
  },
];

const gapSlices: CoverageSlice[] = [
  {
    slice: 'organic-uploads:AeroPress',
    state: 'available',
    sourceId: 'youtube-public-rss',
    connectorVersion: '1.2.0',
    dateWindow: 'last 15 uploads',
    note: 'keyless uploads RSS resolved for channel UC123',
  },
  {
    slice: 'paid-ads:Wacaco',
    state: 'unavailable',
    sourceId: 'google-ads-transparency',
    connectorVersion: '1.1.0',
    note: 'not resolvable through the public transparency service in this run',
  },
];

const p5Signals: Signal[] = [
  { subjectRef: 'yt:recent', velocity: 41.7, total: 1204, note: 'velocity over comparable 7-day window on views' },
  {
    subjectRef: 'yt:old',
    noObservation: {
      reason: 'before_coverage',
      detail: 'first observation of this entity is 2026-10-29T10:00:00Z — the window begins after it',
    },
    note: 'no observation for the requested as-of time',
  },
];

const p5Opportunity: Opportunity = {
  hypothesis: {
    id: 'hypothesis-1',
    pattern: {
      problem: 'cleaning takes effort',
      message: 'proof-first demonstration',
      hook: 'watch the pressure build',
      format: 'short (9:16 vertical)',
      demonstration: 'side-by-side before/after',
      cta: 'see the bundle',
    },
    supportedBy: [
      { ref: 'atc:creative-1', supports: 'paid signal' },
      { ref: 'yt:recent', supports: 'organic signal' },
    ],
    contradictedBy: [],
    predictedOutcome: { low: 400, expected: 900, high: 1600, metricKey: 'views' },
    confidence: 0.55,
  },
  observed: 41.7,
  crossSourceSupport: 2,
  predicted: 900,
  confidence: 0.55,
  explanation: 'the paid×organic intersection is grounded in observed records only',
};

const p5Evidence: Evidence = {
  ads: [
    {
      id: 'atc:creative-1',
      advertiserId: 'advertiser-1',
      format: 'video (in-stream)',
      firstShownAt: '2026-09-14',
      lastShownAt: '2026-10-28',
      source: { sourceId: 'google-ads-transparency', connectorVersion: '1.1.0' },
    },
  ],
  organic: [
    {
      id: 'yt:recent',
      publishedAt: '2026-10-20T00:00:00Z',
      format: 'video (channel upload)',
      source: { sourceId: 'youtube-public-rss', connectorVersion: '1.2.0' },
    },
  ],
  metrics: [
    {
      subjectRef: 'yt:recent',
      metricKey: 'views',
      value: 1204,
      observedAt: '2026-10-30T00:00:00Z',
      source: { sourceId: 'youtube-public-rss' },
    },
  ],
};

const p5Report = (slices: CoverageSlice[], signals: Signal[]): Report => ({
  missionId: 'mission-p5',
  brief: p5Brief,
  competitors: [],
  coverage: { slices, supportsConclusion: 'directional creative patterns only — no performance claims' },
  signals,
  opportunities: [p5Opportunity],
});

const rootElement: { innerHTML: string } = { innerHTML: '' };

/** Renders the report tab for the fixture mission and returns the HTML string. */
const renderReportTab = (report: Report, evidence: Evidence | null, locale: 'en' | 'zh' = 'en'): string => {
  S.locale = locale;
  S.strings = locale === 'zh' ? zh : en;
  S.loading = false;
  S.notice = null;
  S.tab = 'report';
  S.missions = [p5Entry];
  S.selectedId = p5Entry.missionId;
  S.report = report;
  S.evidence = evidence;
  S.creative = null;
  S.loop = null;
  S.connections = [];
  render();
  return rootElement.innerHTML;
};

describe('WO-P5 panel disclosure (AT-P5.4, AT-P5.2)', () => {
  beforeAll(() => {
    // Minimal document stub: the renderers are template-string builders, only
    // setHtml + wiring touch the DOM (the full browser drive is the e2e script).
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string): { innerHTML: string } | null => (id === 'root' ? rootElement : null),
      querySelectorAll: (): unknown[] => [],
    };
    setActions({
      refreshAll: async () => {},
      startNewMissionFlow: async () => {},
      submitStart: async () => {},
      submitDiscover: async () => {},
      runResearch: () => {},
      selectMission: () => {},
      selectTab: () => {},
    });
  });

  it('AT-P5.4: shows the source coverage windows/limits inline at the signals card and the opportunities list', () => {
    const html = renderReportTab(p5Report(windowedSlices, p5Signals), p5Evidence);
    // The keyless organic feed's rolling-window limit (no complete archive) is
    // visible at both points of use; the paid source's reported window too.
    expect(html).toContain('youtube-public-rss</span> — last 15 uploads');
    expect(html).toContain('google-ads-transparency</span> — 2026-09-14→2026-10-28');
    expect(html).toContain('not a complete history');
    // Exactly one compact disclosure per point of use (signals + opportunities).
    expect(html.match(/point-of-use-coverage/g)?.length).toBe(2);
    // The standalone coverage card stays the full view and now carries the
    // window verbatim next to each slice note.
    expect(html).toContain('last 15 uploads · keyless uploads RSS resolved for channel UC123');
  });

  it('AT-P5.4: derives the point-of-use disclosure from the coverage slices when evidence is unavailable', () => {
    const html = renderReportTab(p5Report(gapSlices, p5Signals), null);
    expect(html).toContain('youtube-public-rss</span> — last 15 uploads');
    // A source whose slices carry no window shows its honest state as the limit marker.
    expect(html).toContain('google-ads-transparency</span> — unavailable');
    expect(html.match(/point-of-use-coverage/g)?.length).toBe(2);
  });

  it('AT-P5.2: a valueless signal renders the explicit no-observation chip with its reason; a valued signal renders no chip', () => {
    const html = renderReportTab(p5Report(windowedSlices, p5Signals), p5Evidence);
    expect(html).toContain('no observation</span> before coverage');
    // The honest detail from the contract payload renders verbatim.
    expect(html).toContain('first observation of this entity is 2026-10-29T10:00:00Z');
    // The valued signal keeps its scores and carries no chip.
    expect(html).toContain('velocity/7d');
    expect(html.match(/class="score no-observation"/g)?.length).toBe(1);
  });

  it('AT-P5.2: a valueless signal from an older report shape renders the honest fallback wording, never an inferred reason', () => {
    const legacy: Signal[] = [{ subjectRef: 'yt:legacy', note: 'no observable metric — signal unavailable, not invented' }];
    const html = renderReportTab(p5Report(windowedSlices, legacy), p5Evidence);
    expect(html).toContain('no observation recorded');
    expect(html).not.toContain('before coverage');
    expect(html).not.toContain('insufficient window');
    expect(html).not.toContain('not observed');
  });

  it('AT-P5.2 (contract): marketing_mission_report declares the optional noObservation field in its output schema', async () => {
    // The §2 seam: the field must be declared server-side so it survives SDK
    // output validation once the workflow side starts emitting it (optional —
    // older workflow output without it stays valid).
    const runtime = new MarketingRuntime(here);
    const server = createMarketingServer(runtime, { panelHtml: async () => '<!doctype html><html></html>' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'p5-schema-test', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const report = tools.find((tool) => tool.name === 'marketing_mission_report');
      expect(report).toBeDefined();
      const schema = JSON.stringify(report?.outputSchema ?? {});
      expect(schema).toContain('noObservation');
      expect(schema).toContain('before_coverage');
      expect(schema).toContain('insufficient_window');
      expect(schema).toContain('not_observed');
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
    }
  });

  it('AT-P5.4 + AT-P5.2 (zh): the point-of-use disclosure, the chip and the fallback render localized', () => {
    const html = renderReportTab(p5Report(windowedSlices, p5Signals), p5Evidence, 'zh');
    expect(html).toContain('使用点的来源覆盖');
    expect(html).toContain('并非完整历史');
    expect(html).toContain('youtube-public-rss</span> — last 15 uploads');
    expect(html).toContain('无观测</span> 早于覆盖起点');
    const legacy = renderReportTab(
      p5Report(windowedSlices, [{ subjectRef: 'yt:legacy', note: 'no observable metric' }]),
      p5Evidence,
      'zh',
    );
    expect(legacy).toContain('无观测记录');
  });
});
