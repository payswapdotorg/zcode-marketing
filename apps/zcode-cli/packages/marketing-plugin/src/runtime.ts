/**
 * Marketing plugin runtime — workspace-backed mission state for the marketing
 * MCP tools (W3 runtime integration).
 *
 * Governance: docs/marketing/ — the existing ZCode runtime stays the only
 * execution engine; this module only persists mission state and composes the
 * already-verified connectors of `@zcode/marketing`. It performs no planning,
 * no model side-channels, and no platform I/O of its own.
 *
 * Layering: `@zcode/marketing` public entrypoint only. All file I/O lives here
 * (adapters-equivalent boundary of the plugin), never in domain code.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CapabilityCatalog,
  FallbackModelPort,
  HeuristicModel,
  MarketingMission,
  SampleConnector,
  SqliteTemporalStore,
  YoutubePublicConnector,
  GoogleAdsTransparencyConnector,
  competitorCandidate,
  coverageReport,
  productBrief,
} from '@zcode/marketing';
import type {
  CompetitorCandidate,
  ConnectorMeta,
  MarketingConnector,
  ModelPort,
  ProductBrief,
  TemporalStorePort,
} from '@zcode/marketing';
import type { TransparencyFetchLike } from '@zcode/marketing';
import { McpSamplingModel, type SamplingClient } from './samplingModel.js';

export const researchMode = z.enum(['live', 'demo']);
export type ResearchMode = z.infer<typeof researchMode>;

/**
 * Persisted per-mission state. The brief and the user-correctable competitor
 * list live in a JSON index so missions survive across tool calls and CLI
 * sessions; observations live in the SQLite temporal store (one db per mission).
 */
export const missionIndexEntry = z.object({
  missionId: z.string().min(1),
  brief: productBrief,
  researchMode,
  createdAt: z.string().min(1),
  competitors: z.array(competitorCandidate).default([]),
});
export type MissionIndexEntry = z.infer<typeof missionIndexEntry>;

const missionIndexFile = z.object({
  kind: z.literal('marketing-mission-index'),
  version: z.literal(1),
  missions: z.array(missionIndexEntry),
});

export interface LoadedMission {
  entry: MissionIndexEntry;
  mission: MarketingMission;
  connector: MarketingConnector;
  /** Temporal store handle kept open between tool calls; closed on runtime close. */
  store: TemporalStorePort;
}

const unionCapabilities = (connectors: MarketingConnector[]): ConnectorMeta['capabilities'] => ({
  research: connectors.some((c) => c.meta.capabilities.research),
  analytics: connectors.some((c) => c.meta.capabilities.analytics),
  publishing: connectors.some((c) => c.meta.capabilities.publishing),
  scheduling: connectors.some((c) => c.meta.capabilities.scheduling),
  paidAds: connectors.some((c) => c.meta.capabilities.paidAds),
});

/**
 * Composite connector — merges research pages from already-verified connectors
 * and keeps every child's coverage slices verbatim (never massaged). It exists
 * so a mission can combine an organic source with an ad-intelligence source
 * without any connector bypassing PLATFORM-CONNECTOR-CONTRACT.md. Publishing is
 * not delegated in this wave (no child declares it).
 */
export class CompositeConnector implements MarketingConnector {
  readonly meta: ConnectorMeta;

  constructor(
    private readonly children: MarketingConnector[],
    platform: ProductBrief['platform'],
  ) {
    if (children.length === 0) throw new Error('composite connector needs at least one child');
    this.meta = {
      id: 'connector:runtime-composite',
      version: '0.1.0',
      platform,
      capabilities: unionCapabilities(children),
      authModel: 'public',
      verificationRef: children
        .map((c) => `${c.meta.id} (${c.meta.verificationRef})`)
        .join('; '),
      supportedRegions: [...new Set(children.flatMap((c) => c.meta.supportedRegions))],
      expectedFreshness: children.map((c) => `${c.meta.id}: ${c.meta.expectedFreshness}`).join('; '),
      retentionNote: children.map((c) => `${c.meta.id}: ${c.meta.retentionNote}`).join('; '),
    };
  }

  async research(request: Parameters<MarketingConnector['research']>[0]) {
    const pages = [];
    for (const child of this.children) {
      if (!child.meta.capabilities.research) continue;
      // A failing child surfaces its own typed error; coverage states stay with
      // the child connector that produced them.
      pages.push(await child.research(request));
    }
    return {
      ads: pages.flatMap((p) => p.ads),
      organic: pages.flatMap((p) => p.organic),
      metrics: pages.flatMap((p) => p.metrics),
      coverage: pages.flatMap((p) => p.coverage),
      accessMethod: pages[0]?.accessMethod ?? ('officialApi' as const),
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const results = await Promise.all(
      this.children.map(async (c) => {
        const h = await c.healthCheck();
        return `${c.meta.id}: ${h.ok ? 'ok' : 'down'} (${h.detail})`;
      }),
    );
    return { ok: results.length > 0, detail: results.join(' | ') };
  }
}

export interface RuntimeOptions {
  now?: () => string;
  /** Injectable fetch so the YouTube public connector stays offline in tests. */
  fetchLike?: (url: string) => Promise<{ status: number; body: string }>;
  /** Injectable POST fetch so the transparency connector stays offline in tests. */
  transparencyFetchLike?: TransparencyFetchLike;
}

export class MarketingRuntime {
  private readonly dir: string;
  private readonly loaded = new Map<string, LoadedMission>();
  /** Late-bound host sampling channel (W3-2): set by main() after the MCP
   * initialize handshake when the host declared the `sampling` capability. */
  private sampling?: SamplingClient;
  private modelPort?: ModelPort;

  constructor(workspaceRoot: string, private readonly opts: RuntimeOptions = {}) {
    this.dir = join(workspaceRoot, '.zcode', 'marketing');
  }

  /** Binds the host sampling channel; must be called before the first mission open. */
  setSamplingClient(client: SamplingClient): void {
    if (this.modelPort) {
      throw new Error('sampling client must be bound before missions open');
    }
    this.sampling = client;
  }

  /**
   * Production model port (W3-2): host-routed sampling as primary with the
   * labeled heuristic adapter as recorded fallback; without a host sampling
   * channel the labeled heuristic runs alone (tests/demo wiring). The catalog
   * never sees the fallback as a competing production capability.
   */
  buildModelPort(): ModelPort {
    if (!this.modelPort) {
      this.modelPort = this.sampling
        ? new FallbackModelPort(new McpSamplingModel(this.sampling), new HeuristicModel())
        : new HeuristicModel();
    }
    return this.modelPort;
  }

  private get now(): () => string {
    return this.opts.now ?? (() => new Date().toISOString());
  }

  private async readIndex(): Promise<z.infer<typeof missionIndexFile>> {
    try {
      const raw = JSON.parse(await readFile(await this.indexPath(), 'utf8'));
      return missionIndexFile.parse(raw);
    } catch {
      return { kind: 'marketing-mission-index', version: 1, missions: [] };
    }
  }

  private async writeIndex(index: z.infer<typeof missionIndexFile>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(await this.indexPath(), JSON.stringify(index, null, 2));
  }

  private async indexPath(): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    return join(this.dir, 'missions-index.json');
  }

  /** Connectors honestly available for the mission's platform + research mode. */
  buildConnector(entry: MissionIndexEntry): MarketingConnector {
    const children: MarketingConnector[] = [];
    if (entry.brief.platform === 'youtube') {
      children.push(
        this.opts.fetchLike ? new YoutubePublicConnector(this.opts.fetchLike) : new YoutubePublicConnector(),
      );
      if (entry.researchMode === 'live') {
        // W1-3(b) verified ad-intelligence source (2026-10-29): live youtube
        // missions now ingest real paid-side creatives from the Google Ads
        // Transparency Center (ads served on Google surfaces incl. YouTube,
        // mission region). Synthetic fixtures are NEVER used in live mode.
        children.push(
          this.opts.transparencyFetchLike
            ? new GoogleAdsTransparencyConnector(this.opts.transparencyFetchLike)
            : new GoogleAdsTransparencyConnector(),
        );
      }
    }
    if (entry.researchMode === 'demo') {
      // Synthetic fixtures, labeled as such by the connector's own coverage
      // slices (MARKETING-DATA-SOURCES.md sample row).
      children.push(new SampleConnector());
    }
    if (children.length === 0) {
      throw new Error(
        `no verified connector for platform '${entry.brief.platform}' — add the platform to MARKETING-DATA-SOURCES.md after access verification (W1 gate) before using it in live mode`,
      );
    }
    return new CompositeConnector(children, entry.brief.platform);
  }

  /** Loads (or reopens) a mission with its SQLite temporal store. */
  async open(missionId: string): Promise<LoadedMission> {
    const cached = this.loaded.get(missionId);
    if (cached) return cached;
    const index = await this.readIndex();
    const entry = index.missions.find((m) => m.missionId === missionId);
    if (!entry) {
      throw new Error(`unknown mission '${missionId}' — start it with marketing_mission_start`);
    }
    const connector = this.buildConnector(entry);
    await mkdir(join(this.dir, 'missions'), { recursive: true });
    const store = SqliteTemporalStore.open(join(this.dir, 'missions', `${missionId}.sqlite`), this.now);
    const mission = new MarketingMission(
      entry.brief,
      connector,
      new CapabilityCatalog(this.buildModelPort()),
      this.now,
      store,
    );
    const loaded: LoadedMission = { entry, mission, connector, store };
    this.loaded.set(missionId, loaded);
    return loaded;
  }

  async start(input: { missionId: string; brief: ProductBrief; researchMode: ResearchMode }): Promise<MissionIndexEntry> {
    const index = await this.readIndex();
    if (index.missions.some((m) => m.missionId === input.missionId)) {
      throw new Error(`mission '${input.missionId}' already exists — list it with marketing_mission_list`);
    }
    const entry = missionIndexEntry.parse({
      missionId: input.missionId,
      brief: input.brief,
      researchMode: input.researchMode,
      createdAt: this.now(),
      competitors: [],
    });
    this.buildConnector(entry); // fails fast on unsupported platform
    index.missions.push(entry);
    await this.writeIndex(index);
    return entry;
  }

  async list(): Promise<MissionIndexEntry[]> {
    return (await this.readIndex()).missions;
  }

  /** Persists competitor candidates (user corrections kept as explicit revisions). */
  async saveCompetitors(missionId: string, competitors: CompetitorCandidate[]): Promise<void> {
    const index = await this.readIndex();
    const row = index.missions.find((m) => m.missionId === missionId);
    if (!row) throw new Error(`unknown mission '${missionId}'`);
    row.competitors = competitors;
    await this.writeIndex(index);
    const loaded = this.loaded.get(missionId);
    if (loaded) loaded.entry.competitors = competitors;
  }

  /** Research run through the connector; idempotent by construction (W2 gate). */
  async research(missionId: string): Promise<z.infer<typeof coverageReport>> {
    const { entry, mission } = await this.open(missionId);
    if (entry.competitors.length === 0) {
      throw new Error(
        `mission '${missionId}' has no competitor candidates yet — run marketing_discover_competitors first`,
      );
    }
    return mission.research(entry.competitors);
  }

  async close(): Promise<void> {
    for (const m of this.loaded.values()) {
      await (m.store as unknown as { close?: () => void }).close?.();
    }
    this.loaded.clear();
  }
}

/** Typed tool failure — surfaced to the model as a structured error, never a crash. */
export class MarketingToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketingToolError';
  }
}
