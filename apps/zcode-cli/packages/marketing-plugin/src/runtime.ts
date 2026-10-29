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
import { mkdir, readFile, writeFile, open, unlink, readdir, stat } from 'node:fs/promises';
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
  creativeArtifact,
  creativeHypothesis,
  productBrief,
} from '@zcode/marketing';
import type {
  AdCreative,
  CompetitorCandidate,
  ConnectorMeta,
  CreativeArtifact,
  CreativeFeatureSet,
  CreativeHypothesis,
  MarketingConnector,
  ModelPort,
  OrganicContent,
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

/**
 * W4 persisted creative state: ranked hypotheses (so a draft can reference the
 * exact opportunity the user picked, by id, across processes) and the creative
 * artifacts (prompt packs, uploaded assets + their rubric reports).
 */
export const missionArtifactsFile = z.object({
  kind: z.literal('marketing-mission-artifacts'),
  version: z.literal(1),
  missionId: z.string().min(1),
  hypotheses: z.array(creativeHypothesis).default([]),
  artifacts: z.array(creativeArtifact).default([]),
});
export type MissionArtifactsFile = z.infer<typeof missionArtifactsFile>;

export interface LoadedMission {
  entry: MissionIndexEntry;
  mission: MarketingMission;
  connector: MarketingConnector;
  /** Temporal store handle kept open between tool calls; closed on runtime close. */
  store: TemporalStorePort;
  /** W4 creative state (hypotheses + artifacts), mirrored to a per-mission JSON file. */
  artifacts: MissionArtifactsFile;
  /**
   * Per-subject creative-feature cache (W3-3). Observed subject records are
   * immutable (same id = same content), so re-running model extraction on every
   * analyze/rank/report call only duplicated paid model calls and blew the
   * host's 30s MCP tool budget. Cached feature sets keep their original
   * provenance; subjects ingested after the last call extract on the next one.
   */
  featureCache: Map<string, CreativeFeatureSet>;
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

/** One in-flight chunked asset import (W4): the panel streams base64 chunks. */
interface ImportSession {
  id: string;
  missionId: string;
  name: string;
  declaredBytes: number;
  received: number;
  handle: import('node:fs/promises').FileHandle;
  path: string;
}

export class MarketingRuntime {
  private readonly dir: string;
  private readonly loaded = new Map<string, LoadedMission>();
  private readonly imports = new Map<string, ImportSession>();
  private importCounter = 0;
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
    const artifacts = await this.readArtifacts(missionId);
    const loaded: LoadedMission = { entry, mission, connector, store, artifacts, featureCache: new Map() };
    this.loaded.set(missionId, loaded);
    return loaded;
  }

  /** W4: per-mission creative state file (hypotheses + artifacts). */
  private async readArtifacts(missionId: string): Promise<MissionArtifactsFile> {
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'missions', `${missionId}-artifacts.json`), 'utf8'));
      return missionArtifactsFile.parse(raw);
    } catch {
      return { kind: 'marketing-mission-artifacts', version: 1, missionId, hypotheses: [], artifacts: [] };
    }
  }

  private async writeArtifacts(loaded: LoadedMission): Promise<void> {
    await mkdir(join(this.dir, 'missions'), { recursive: true });
    await writeFile(
      join(this.dir, 'missions', `${loaded.entry.missionId}-artifacts.json`),
      JSON.stringify(loaded.artifacts, null, 2),
    );
  }

  /** Persists ranked hypotheses (id-stable across processes so drafts can cite them).
   *
   * Content-dedupe: rank/report both regenerate hypotheses on every call; the
   * same evidence-backed pattern keeps its original id instead of piling up
   * near-duplicates (pattern message+hook+format+cta+predicted outcome is the
   * identity). Drafts reference ids; ids must stay stable for the same idea. */
  async saveHypotheses(missionId: string, hypotheses: CreativeHypothesis[]): Promise<void> {
    const loaded = await this.open(missionId);
    const patternKey = (h: CreativeHypothesis): string =>
      JSON.stringify([
        h.pattern.problem,
        h.pattern.message,
        h.pattern.hook,
        h.pattern.format,
        h.pattern.demonstration,
        h.pattern.cta,
        h.predictedOutcome.metricKey,
        h.predictedOutcome.low,
        h.predictedOutcome.expected,
        h.predictedOutcome.high,
      ]);
    const known = new Map(loaded.artifacts.hypotheses.map((h) => [patternKey(h), h] as const));
    for (const hypothesis of hypotheses) {
      const key = patternKey(hypothesis);
      const existing = known.get(key);
      if (existing) {
        // Keep the stable id; refresh the volatile fields (confidence, refs).
        known.set(key, { ...hypothesis, id: existing.id });
      } else {
        known.set(key, hypothesis);
      }
    }
    loaded.artifacts.hypotheses = [...known.values()];
    await this.writeArtifacts(loaded);
  }

  async findHypothesis(missionId: string, hypothesisId: string): Promise<CreativeHypothesis> {
    const loaded = await this.open(missionId);
    const hypothesis = loaded.artifacts.hypotheses.find((h) => h.id === hypothesisId);
    if (!hypothesis) {
      throw new MarketingToolError(
        'unknown_hypothesis',
        `mission '${missionId}' has no hypothesis '${hypothesisId}' — run marketing_rank_opportunities first, then reference the hypothesis id it returned`,
      );
    }
    return hypothesis;
  }

  /** Adds or updates a creative artifact (prompt packs, uploaded assets). */
  async saveArtifact(missionId: string, artifact: CreativeArtifact): Promise<void> {
    const loaded = await this.open(missionId);
    const next = loaded.artifacts.artifacts.filter((a) => a.id !== artifact.id);
    next.push(artifact);
    loaded.artifacts.artifacts = next;
    await this.writeArtifacts(loaded);
  }

  async getArtifact(missionId: string, artifactId: string): Promise<CreativeArtifact> {
    const loaded = await this.open(missionId);
    const artifact = loaded.artifacts.artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      throw new MarketingToolError(
        'unknown_artifact',
        `mission '${missionId}' has no artifact '${artifactId}' — call marketing_draft_creative (or import an asset) first`,
      );
    }
    return artifact;
  }

  // -------------------------------------------------------------------------
  // W4 chunked asset import (office begin/write/finish convention, app-only
  // visibility): the panel streams the produced file into the mission
  // workspace so the mission holds the actual asset, not just a declaration.
  // -------------------------------------------------------------------------
  async beginAssetImport(input: { missionId: string; name: string; size: number }): Promise<{ id: string }> {
    const loaded = await this.open(input.missionId);
    void loaded;
    const safe = input.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    if (safe.length === 0) throw new MarketingToolError('invalid_input', 'asset name is empty after sanitization');
    if (input.size <= 0 || input.size > 512 * 1024 * 1024) {
      throw new MarketingToolError('invalid_input', 'asset size must be between 1 byte and 512 MiB');
    }
    const id = `asset-${(this.importCounter += 1)}-${Date.now()}`;
    const dir = join(this.dir, 'missions', input.missionId, 'assets');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${id}-${safe}`);
    const handle = await open(path, 'wx');
    this.imports.set(id, {
      id,
      missionId: input.missionId,
      name: safe,
      declaredBytes: input.size,
      received: 0,
      handle,
      path,
    });
    return { id };
  }

  async writeAssetChunk(id: string, offset: number, base64: string): Promise<void> {
    const session = this.imports.get(id);
    if (!session) throw new MarketingToolError('unknown_import', `no asset import in progress '${id}'`);
    const chunk = Buffer.from(base64, 'base64');
    if (chunk.byteLength === 0) throw new MarketingToolError('invalid_input', 'empty chunk');
    await session.handle.write(chunk, offset);
    session.received += chunk.byteLength;
  }

  async finishAssetImport(id: string): Promise<{ name: string; bytes: number; path: string }> {
    const session = this.imports.get(id);
    if (!session) throw new MarketingToolError('unknown_import', `no asset import in progress '${id}'`);
    if (session.received !== session.declaredBytes) {
      await session.handle.close();
      await unlink(session.path).catch(() => undefined);
      this.imports.delete(id);
      throw new MarketingToolError(
        'invalid_input',
        `import '${id}' declared ${session.declaredBytes} bytes but received ${session.received} — import aborted, retry from begin`,
      );
    }
    await session.handle.close();
    this.imports.delete(id);
    return {
      name: session.name,
      bytes: session.received,
      // Workspace-relative so it never leaks an absolute host path into records.
      path: session.path.split('.zcode').pop()!.replace(/^\//, '.zcode/'),
    };
  }

  /** Resolves a completed import's stored file by import id (record step). */
  async resolveImportedAsset(
    missionId: string,
    importedAssetId: string,
  ): Promise<{ name: string; bytes: number; path: string }> {
    const dir = join(this.dir, 'missions', missionId, 'assets');
    const entries = await readdir(dir).catch(() => [] as string[]);
    const match = entries.find((name) => name.startsWith(`${importedAssetId}-`));
    if (!match) {
      throw new MarketingToolError(
        'unknown_import',
        `no imported asset '${importedAssetId}' in mission '${missionId}' — complete a marketing_asset_import_begin/write/finish chain first`,
      );
    }
    const absolute = join(dir, match);
    const info = await stat(absolute);
    return {
      name: match.slice(importedAssetId.length + 1),
      bytes: info.size,
      // Workspace-relative so records never leak absolute host paths.
      path: absolute.split('.zcode').pop()!.replace(/^\//, '.zcode/'),
    };
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

  /**
   * Cached creative-feature extraction (W3-3): extraction runs once per subject
   * per mission process; analyze/rank/report share the cached domain records.
   * New subjects extract on the call that first observes them.
   */
  async extractFeatures(
    loaded: LoadedMission,
    subjects: Array<AdCreative | OrganicContent>,
  ): Promise<CreativeFeatureSet[]> {
    const fresh = subjects.filter((s) => !loaded.featureCache.has(s.id));
    if (fresh.length > 0) {
      const extracted = await loaded.mission.extractFeatures(fresh);
      for (const features of extracted) loaded.featureCache.set(features.subjectRef, features);
    }
    return subjects
      .map((s) => loaded.featureCache.get(s.id))
      .filter((features): features is CreativeFeatureSet => features !== undefined);
  }

  async close(): Promise<void> {
    for (const session of this.imports.values()) {
      await session.handle.close().catch(() => undefined);
      await unlink(session.path).catch(() => undefined);
    }
    this.imports.clear();
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
