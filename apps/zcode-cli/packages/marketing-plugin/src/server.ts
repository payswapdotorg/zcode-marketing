/**
 * Marketing MCP server — registers the marketing mission tools on the existing
 * plugin tool chain (W3-1, docs/marketing/MARKETING-CAPABILITY-MAP.md).
 *
 * Every tool declares a zod inputSchema and a zod outputSchema (tool change
 * chain spec: runtime-validatable contracts at tool boundaries) — outputs reuse
 * the canonical domain records from @zcode/marketing rather than parallel
 * schemas. Side effects are declared via annotations (readOnlyHint); nothing in
 * this wave is destructive. Coverage gaps and synthetic evidence are always
 * stated explicitly; the model never has to guess what is real.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  adCreative,
  competitorCandidate,
  coverageReport,
  creativeFeatureSet,
  creativeHypothesis,
  marketingObjective,
  metricObservation,
  organicContent,
  platform as platformSchema,
  productBrief,
} from '@zcode/marketing';
import type { OpportunityScore } from '@zcode/marketing';
import { MarketingRuntime, MarketingToolError, missionIndexEntry, researchMode } from './runtime.js';
import { SERVER_NAME, PLUGIN_VERSION, PANEL_URI, PANEL_MIME } from './serverConstants.js';
import { createRegistrar } from './toolRegistrar.js';
import { registerW4Tools } from './w4Tools.js';
import { registerW5Tools } from './w5Tools.js';
import { registerW6Tools } from './w6Tools.js';

// Re-exported for the contract tests (import surface unchanged since W3-1).
export { PLUGIN_NAME, PLUGIN_VERSION, SERVER_NAME, PANEL_URI, PANEL_MIME, SURFACE_ID } from './serverConstants.js';

/** Resolves dist/panel.html next to the built server entry (dist/server.mjs). */
const defaultPanelHtml = async (): Promise<string> =>
  readFile(join(dirname(fileURLToPath(import.meta.url)), 'panel.html'), 'utf8');

export interface MarketingServerOptions {
  /** Injectable for tests; default reads dist/panel.html next to the server entry. */
  panelHtml?: () => Promise<string>;
}

const PLATFORM_HINT =
  "Only platforms with a verified connector may be researched (MARKETING-DATA-SOURCES.md). 'youtube' is verified: organic via keyless public routes + paid via the Google Ads Transparency Center (W1-3(b), verified 2026-10-29); 'tiktok'/'meta' have no verified connector yet.";
const MODE_HINT =
  "researchMode 'demo' additionally ingests the labeled synthetic fixtures (connector:sample) so the full paid x organic loop works end to end; 'live' uses verified sources only — real paid-side ads come from the Google Ads Transparency Center, and every coverage limitation is reported, never silently filled.";

/** Shared output shapes (raw zod shapes, canonical records reused). */
const opportunityScoreShape = {
  hypothesis: creativeHypothesis,
  observed: z.number(),
  crossSourceSupport: z.number(),
  predicted: z.number(),
  confidence: z.number(),
  explanation: z.string(),
};
const performanceSignalShape = {
  subjectRef: z.string(),
  velocity: z.number().optional(),
  total: z.number().optional(),
  // WO-P5 §2 pinned contract: velocity/total stay absent exactly when no
  // observation supports them — noObservation states WHY, so the panel can
  // render an explicit no-observation chip instead of a blank row (AT-P5.2).
  // Optional on purpose: older workflow output without it stays valid.
  noObservation: z
    .object({
      reason: z.enum(['before_coverage', 'insufficient_window', 'not_observed']),
      detail: z.string(),
    })
    .optional(),
  note: z.string(),
};

/**
 * Research-integrity gate (docs/marketing/MARKETING-EVALUATION.md: "a
 * recommendation without a traceable EvidenceReference is an automatic
 * failure", enforced mechanically, not prompted). A ranked opportunity is
 * kept only when every `supportedBy` ref resolves to a record the mission
 * actually observed (an ingested ad or organic content id). Model adapters
 * are never trusted to self-police: opportunities citing unrecorded
 * evidence are DROPPED and the drop is reported, never silently kept.
 */
export function applyResearchIntegrityGate(
  ads: Array<{ id: string }>,
  organic: Array<{ id: string }>,
  opportunities: OpportunityScore[],
): { kept: OpportunityScore[]; dropped: number; droppedRefs: string[] } {
  const resolvable = new Set<string>([...ads.map((a) => a.id), ...organic.map((o) => o.id)]);
  const kept: OpportunityScore[] = [];
  const droppedRefs: string[] = [];
  for (const opportunity of opportunities) {
    const unresolved = opportunity.hypothesis.supportedBy.filter((e) => !resolvable.has(e.ref));
    if (unresolved.length === 0) {
      kept.push(opportunity);
    } else {
      droppedRefs.push(...unresolved.map((e) => e.ref));
    }
  }
  return { kept, dropped: opportunities.length - kept.length, droppedRefs };
}

const integrityGateNote = (result: { dropped: number; droppedRefs: string[] }): string[] =>
  result.dropped > 0
    ? [
        `research-integrity gate: ${result.dropped} candidate opportunities were DROPPED — they cited evidence refs not recorded in this mission (${[...new Set(result.droppedRefs)].join(', ')}). MARKETING-EVALUATION.md: a recommendation without a traceable EvidenceReference is an automatic failure; the drop is reported, never silent.`,
      ]
    : [];

export function createMarketingServer(
  runtime: MarketingRuntime,
  options: MarketingServerOptions = {},
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: PLUGIN_VERSION });
  const panelHtml = options.panelHtml ?? defaultPanelHtml;

  const register = createRegistrar(server);

  // ---------------------------------------------------------------
  // Onboarding — the user describes a product, chooses a platform.
  // ---------------------------------------------------------------
  register(
    'marketing_mission_start',
    {
      description:
        `Start a marketing intelligence mission: describe the product, audience, offer and objective. ${PLATFORM_HINT} ${MODE_HINT} ` +
        'Returns the persisted ProductBrief and the next steps (discover competitors, research platform, analyze, report).',
      input: {
        product: z.string().min(1).max(2000).describe('What the product is, one line.'),
        audience: z.string().min(1).max(2000).describe('Target audience, one line.'),
        country: z.string().min(2).max(2).describe('ISO country code for the intended market, e.g. US.'),
        platform: platformSchema.describe('Platform to research. ' + PLATFORM_HINT),
        offer: z.string().min(1).max(2000).describe('The offer being promoted (trial, price, bundle...).'),
        objective: marketingObjective.describe('Marketing objective; performance signals are objective-appropriate (views are never sales).'),
        constraints: z.array(z.string().max(500)).optional().describe('Brand/claim constraints, e.g. no discount-first messaging.'),
        landingUrl: z.string().optional().describe('Product landing page, if the user gave one.'),
        researchMode: z.enum(['live', 'demo']).default('live').describe(MODE_HINT),
        missionId: z.string().optional().describe('Stable mission id; auto-generated when omitted.'),
      },
      output: { missionId: z.string(), researchMode: researchMode, brief: productBrief },
      readOnly: false,
      panel: true,
    },
    async (input) => {
      const missionId =
        input.missionId ?? `mission-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const brief = productBrief.parse({
        kind: 'ProductBrief',
        id: `brief-${missionId}`,
        missionId,
        product: input.product,
        audience: input.audience,
        country: input.country,
        platform: input.platform,
        offer: input.offer,
        objective: input.objective,
        constraints: input.constraints ?? [],
        ...(input.landingUrl ? { landingUrl: input.landingUrl } : {}),
        createdAt: new Date().toISOString(),
      });
      const entry = await runtime.start({ missionId, brief, researchMode: input.researchMode });
      const text = [
        `Mission started: ${entry.missionId} (${entry.researchMode} mode)`,
        `Product: ${entry.brief.product} — offer: ${entry.brief.offer}`,
        `Objective: ${entry.brief.objective}; platform: ${entry.brief.platform}; market: ${entry.brief.country}`,
        '',
        'Next: call marketing_discover_competitors with 2-5 competitor name hints the user mentioned (or ask the user which competitors matter).',
      ].join('\n');
      return { text, structured: { missionId: entry.missionId, researchMode: entry.researchMode, brief: entry.brief } };
    },
  );

  register(
    'marketing_mission_list',
    {
      description: 'List persisted marketing missions with status and research mode.',
      input: {},
      output: { missions: z.array(missionIndexEntry) },
      readOnly: true,
    },
    async () => {
      const missions = await runtime.list();
      if (missions.length === 0) {
        return { text: 'No marketing missions yet. Start one with marketing_mission_start.', structured: { missions: [] } };
      }
      const text = missions
        .map(
          (m) =>
            `- ${m.missionId} [${m.researchMode}] ${m.brief.product} -> ${m.brief.objective} on ${m.brief.platform} (${m.competitors.length} competitors tracked)`,
        )
        .join('\n');
      return { text, structured: { missions } };
    },
  );

  // ---------------------------------------------------------------
  // Stage A — competitor discovery (user-correctable)
  // ---------------------------------------------------------------
  register(
    'marketing_discover_competitors',
    {
      description:
        'Propose competitor candidates for the mission (Stage A). Candidates carry relevance reasons and identity confidence; the user can correct them. Pass display names in `confirm` to mark user-confirmed candidates. Candidates are persisted with the mission.',
      input: {
        missionId: z.string().min(1),
        hints: z.array(z.string().min(1)).min(1).max(8).describe('Competitor name hints (from the user, landing page, or prior knowledge).'),
        confirm: z.array(z.string()).optional().describe('Display names the user explicitly confirmed as competitors.'),
      },
      output: { competitors: z.array(competitorCandidate) },
      readOnly: false,
      panel: true,
    },
    async (input) => {
      const { mission } = await runtime.open(input.missionId);
      const candidates = await mission.discoverCompetitors(input.hints);
      const confirmed = candidates.map((c) =>
        (input.confirm ?? []).includes(c.displayName) ? { ...c, userConfirmed: true } : c,
      );
      await runtime.saveCompetitors(input.missionId, confirmed);
      const text = [
        `Competitor candidates for ${input.missionId}:`,
        ...confirmed.map(
          (c) =>
            `- ${c.displayName} (identity confidence ${c.identityConfidence.toFixed(2)})${c.userConfirmed ? ' [user-confirmed]' : ''} — ${c.relevanceReason}`,
        ),
        '',
        'Ask the user to confirm/correct these (re-call with `confirm` for confirmed names), then proceed with marketing_research_platform.',
      ].join('\n');
      return { text, structured: { competitors: confirmed } };
    },
  );

  // ---------------------------------------------------------------
  // Stage A cont. — platform research through the connector chain
  // ---------------------------------------------------------------
  register(
    'marketing_research_platform',
    {
      description:
        'Research the mission platform through the verified connectors and ingest observations (idempotent — running it twice creates no duplicates). Returns the honest per-slice coverage report: gaps are explicit, never silently filled.',
      input: { missionId: z.string().min(1) },
      output: {
        coverage: coverageReport,
        ingested: z.object({ ads: z.number(), organic: z.number(), metrics: z.number() }),
      },
      readOnly: false,
      panel: true,
    },
    async (input) => {
      const { mission } = await runtime.open(input.missionId);
      const report = await runtime.research(input.missionId);
      const counts = {
        ads: mission.store.allAds().length,
        organic: mission.store.allOrganic().length,
        metrics: mission.store.allMetrics().length,
      };
      const text = [
        `Research run complete for ${input.missionId} — ingested: ${counts.ads} ads, ${counts.organic} organic, ${counts.metrics} metric observations.`,
        '',
        'Coverage (explicit per-slice honesty):',
        ...report.slices.map((s) => `- [${s.state}] ${s.slice} (${s.sourceId} v${s.connectorVersion}) — ${s.note}`),
        '',
        `Conclusion: ${report.supportsConclusion}`,
      ].join('\n');
      return { text, structured: { coverage: report, ingested: counts } };
    },
  );

  // ---------------------------------------------------------------
  // Stage B — creative feature extraction
  // ---------------------------------------------------------------
  register(
    'marketing_analyze_creative',
    {
      description:
        'Extract creative structure (hooks, narrative, offer structure — not a content summary) from the observed ads and organic content (Stage B). Optionally restrict to specific subject ids.',
      input: {
        missionId: z.string().min(1),
        subjectRefs: z.array(z.string()).optional().describe('Restrict analysis to these subject ids (ads/organic).'),
      },
      output: {
        adFeatures: z.array(creativeFeatureSet),
        organicFeatures: z.array(creativeFeatureSet),
      },
      readOnly: true,
    },
    async (input) => {
      const loaded = await runtime.open(input.missionId);
      const ads = input.subjectRefs
        ? loaded.mission.store.allAds().filter((a) => input.subjectRefs!.includes(a.id))
        : loaded.mission.store.allAds();
      const organic = input.subjectRefs
        ? loaded.mission.store.allOrganic().filter((o) => input.subjectRefs!.includes(o.id))
        : loaded.mission.store.allOrganic();
      if (ads.length + organic.length === 0) {
        throw new MarketingToolError(
          'nothing_to_analyze',
          'no observed ads or organic content in the store — run marketing_research_platform first',
        );
      }
      // W3-3: extraction is cached per subject (records are immutable), so
      // repeated analyze/rank/report calls share one extraction per subject.
      const adFeatures = await runtime.extractFeatures(loaded, ads);
      const organicFeatures = await runtime.extractFeatures(loaded, organic);
      const models = [...new Set([...adFeatures, ...organicFeatures].map((f) => f.extractionModelRef))];
      const text = [
        `Creative feature extraction (${input.missionId}): ${adFeatures.length} ad + ${organicFeatures.length} organic feature sets.`,
        `Extraction models used: ${models.join(', ')}`,
        '',
        ...[...adFeatures, ...organicFeatures].map(
          (f) => `- ${f.subjectRef}: hook "${f.hooks[0]?.hook}" (${f.hooks[0]?.attentionPattern}); narrative ${f.narrative.join(' -> ')}; offer: ${f.offerStructure}`,
        ),
        '',
        'Provenance is recorded per feature set (extractionModelRef): `zcode:routed:<model>` = host-routed session model through the sampling channel; `heuristic:*` = labeled stand-in adapter (no host sampling capability, or fallback after a channel failure).',
      ].join('\n');
      return { text, structured: { adFeatures, organicFeatures } };
    },
  );

  // ---------------------------------------------------------------
  // Stages C+D — like-for-like signals, paid x organic ranking
  // ---------------------------------------------------------------
  register(
    'marketing_rank_opportunities',
    {
      description:
        'Rank cross-source creative opportunities (Stages C+D): objective-appropriate performance signals over comparable windows, then the paid x organic intersection with SEPARATED observed / cross-source / predicted / confidence scores and contrary evidence. Live youtube missions ingest real paid-side ads from the Google Ads Transparency Center (W1-3(b) verified); when a mission has no ad observations the tool refuses with paid_source_gap instead of inventing evidence.',
      input: { missionId: z.string().min(1) },
      output: { opportunities: z.array(z.object(opportunityScoreShape)) },
      readOnly: true,
    },
    async (input) => {
      const loaded = await runtime.open(input.missionId);
      const mission = loaded.mission;
      if (mission.store.allAds().length === 0) {
        throw new MarketingToolError(
          'paid_source_gap',
          `no ad observations in this mission — the paid x organic intersection needs ad evidence. Live youtube missions ingest the Google Ads Transparency Center (W1-3(b) verified 2026-10-29): zero ads usually means none of the mission's competitors resolved to an advertiser with ads in the mission region — check the research coverage report (per-competitor resolution outcomes are recorded there). Current mode '${loaded.entry.researchMode}': in demo mode the labeled synthetic fixtures provide the paid side.`,
        );
      }
      const adFeatures = await runtime.extractFeatures(loaded, mission.store.allAds());
      const organicFeatures = await runtime.extractFeatures(loaded, mission.store.allOrganic());
      const ranked: OpportunityScore[] = await mission.rankOpportunities(adFeatures, organicFeatures);
      // Research-integrity gate: keep only opportunities whose evidence refs
      // resolve to records this mission actually observed; report the drop.
      const gated = applyResearchIntegrityGate(mission.store.allAds(), mission.store.allOrganic(), ranked);
      const opportunities: OpportunityScore[] = gated.kept;
      // W4: persist the ranked hypotheses so a creative draft can reference
      // the exact opportunity by id, across processes.
      await runtime.saveHypotheses(
        input.missionId,
        opportunities.map((o) => o.hypothesis),
      );
      const text = [
        `Ranked opportunities (${input.missionId}) — scores are SEPARATED, never blended:`,
        ...opportunities.map(
          (o, i) =>
            `#${i + 1} ${o.hypothesis.pattern.message}\n` +
            `    hook: ${o.hypothesis.pattern.hook} | format: ${o.hypothesis.pattern.format}\n` +
            `    observed ${o.observed.toFixed(1)} | cross-source ${o.crossSourceSupport} | predicted ${o.predicted} | confidence ${o.confidence.toFixed(2)}\n` +
            `    evidence: ${o.hypothesis.supportedBy.map((e) => e.ref).join(', ')}\n` +
            `    contrary: ${o.hypothesis.contradictedBy.length === 0 ? 'none recorded' : o.hypothesis.contradictedBy.map((e) => e.ref).join(', ')}\n` +
            `    why: ${o.explanation}`,
        ),
        ...integrityGateNote(gated),
      ].join('\n');
      return { text, structured: { opportunities } };
    },
  );

  // ---------------------------------------------------------------
  // The evidence-backed report (W3 exit gate)
  // ---------------------------------------------------------------
  register(
    'marketing_mission_report',
    {
      description:
        'Compose the evidence-backed mission report: brief, competitors, honest coverage (explicit gaps), performance signals, ranked opportunities with evidence refs, and limitations. This is the artifact a user reads to decide what to do next.',
      input: { missionId: z.string().min(1) },
      output: {
        missionId: z.string(),
        brief: productBrief,
        competitors: z.array(competitorCandidate),
        coverage: coverageReport.optional(),
        signals: z.array(z.object(performanceSignalShape)),
        opportunities: z.array(z.object(opportunityScoreShape)),
      },
      readOnly: true,
      panel: true,
    },
    async (input) => {
      const loaded = await runtime.open(input.missionId);
      const { entry, mission } = loaded;
      const coverage = mission.store.latestCoverage();
      const competitors = entry.competitors;
      const signals = mission.performanceSignals([
        ...mission.store.allAds().map((a) => a.id),
        ...mission.store.allOrganic().map((o) => o.id),
      ]);
      // WO-P5 §2 consumer side: read the optional noObservation contract field
      // through the report shape so absence is stated in the text report and
      // flows to the panel — without depending on the workflow-side change
      // having landed (the field is optional, the assignment is structural).
      const reportSignals: z.infer<z.ZodObject<typeof performanceSignalShape>>[] = signals;
      let opportunities: OpportunityScore[] = [];
      let opportunityNote =
        'No ranked opportunities: no ad evidence was ingested — check the research coverage report for per-competitor ad-source resolution outcomes, or run demo mode to see the loop with labeled synthetic fixtures.';
      let extractionModelRefs: string[] = [];
      if (mission.store.allAds().length > 0) {
        const adFeatures = await runtime.extractFeatures(loaded, mission.store.allAds());
        const organicFeatures = await runtime.extractFeatures(loaded, mission.store.allOrganic());
        extractionModelRefs = [...new Set([...adFeatures, ...organicFeatures].map((f) => f.extractionModelRef))];
        const ranked: OpportunityScore[] = await mission.rankOpportunities(adFeatures, organicFeatures);
        // Research-integrity gate — same enforcement as the ranking tool.
        const gated = applyResearchIntegrityGate(mission.store.allAds(), mission.store.allOrganic(), ranked);
        opportunities = gated.kept;
        // W4: hypotheses persist with the mission so drafts can cite them.
        await runtime.saveHypotheses(
          input.missionId,
          opportunities.map((o) => o.hypothesis),
        );
        opportunityNote = integrityGateNote(gated).join(' ');
      }
      const syntheticNote =
        entry.researchMode === 'demo'
          ? 'DEMO MODE: fixture ads and the fixture organic entries (yt-101, yt-102) come from the labeled synthetic sample connector; public YouTube entries (yt:<video id>) are real. Every record carries its source id.'
          : 'LIVE MODE: verified public sources only.';
      const extractionNote = (() => {
        const refs = extractionModelRefs;
        if (refs.length === 0) {
          return '- Structured extraction provenance: no model extraction ran for this report (no ranked opportunities to attribute).';
        }
        const routed = refs.filter((r) => r.startsWith('zcode:routed:'));
        const fallback = refs.filter((r) => r.includes('(fallback:'));
        if (routed.length > 0 && fallback.length === 0) {
          return '- Structured extraction ran through the host-routed session model (sampling channel); provenance recorded per record (extractionModelRef).';
        }
        if (routed.length > 0 && fallback.length > 0) {
          return `- Structured extraction partially fell back to the labeled heuristic adapter (channel failure); provenance per record: ${fallback.join('; ')}.`;
        }
        if (routed.length === 0 && fallback.length > 0) {
          return `- Structured extraction fell back entirely to the labeled heuristic adapter (host sampling channel unavailable or declined); provenance per record: ${fallback.join('; ')}.`;
        }
        return '- Labeled heuristic adapters performed the structured extraction (no host sampling capability detected); provenance recorded per record.';
      })();
      const sections: string[] = [];
      sections.push(
        `# Marketing intelligence report — ${entry.missionId}`,
        `## Product\n${entry.brief.product} — offer: ${entry.brief.offer}; audience: ${entry.brief.audience}; objective: ${entry.brief.objective}; market: ${entry.brief.country}; platform: ${entry.brief.platform}.`,
      );
      sections.push(
        `## Competitors (${competitors.length})`,
        ...competitors.map((c) => `- ${c.displayName}${c.userConfirmed ? ' [confirmed]' : ''} — ${c.relevanceReason}`),
      );
      if (coverage) {
        sections.push(
          '## Data coverage (explicit gaps, never silently filled)',
          ...coverage.slices.map((s) => `- [${s.state}] ${s.slice} (${s.sourceId}) — ${s.note}`),
          `Conclusion: ${coverage.supportsConclusion}`,
        );
      } else {
        sections.push(
          '## Data coverage\nNo research run recorded yet — call marketing_research_platform.',
        );
      }
      sections.push(
        '## Performance signals (objective-appropriate, like-for-like)',
        ...reportSignals.map(
          (s) =>
            `- ${s.subjectRef}: ${s.note}${s.total !== undefined ? ` (latest ${s.total})` : ''}${
              s.noObservation ? ` (no observation — ${s.noObservation.reason}: ${s.noObservation.detail})` : ''
            }`,
        ),
      );
      sections.push('## Creative opportunities');
      if (opportunities.length > 0) {
        sections.push(
          ...opportunities.map(
            (o, i) =>
              `#${i + 1} ${o.hypothesis.pattern.message} — hook "${o.hypothesis.pattern.hook}", format ${o.hypothesis.pattern.format}, confidence ${o.confidence.toFixed(2)}; evidence ${o.hypothesis.supportedBy.map((e) => e.ref).join(', ')}`,
          ),
          'Scores (observed / cross-source / predicted / confidence) and contrary evidence: call marketing_rank_opportunities.',
        );
      } else {
        sections.push(opportunityNote);
      }
      sections.push(
        '## Limitations (honest)',
        `- ${syntheticNote}`,
        extractionNote,
        '- View counts are current-snapshot public stats, not full history; velocity uses comparable 7-day windows.',
        entry.researchMode === 'live'
          ? '- Ad intelligence (Google Ads Transparency Center, W1-3(b) verified): real creatives with platform-reported first/last-shown dates — no impressions/spend/ROAS, no per-creative surface split, no targeting data; wire format is the public service data channel (drift risk recorded in MARKETING-DATA-SOURCES.md).'
          : '- Demo mode: do not treat fixture numbers as market facts.',
      );
      const text = sections.join('\n\n');
      return {
        text,
        structured: {
          missionId: entry.missionId,
          brief: entry.brief,
          competitors,
          ...(coverage ? { coverage } : {}),
          signals: reportSignals,
          opportunities,
        },
      };
    },
  );

  // ---------------------------------------------------------------
  // Evidence viewer (provenance for every record)
  // ---------------------------------------------------------------
  register(
    'marketing_evidence_view',
    {
      description:
        'Show every recorded observation with its provenance for the mission — the evidence trail behind any conclusion (which source, which connector version, observed when). Optionally filter to one subject.',
      input: {
        missionId: z.string().min(1),
        subjectRef: z.string().optional().describe('Filter to this subject id, e.g. a specific ad or video.'),
      },
      output: {
        ads: z.array(adCreative),
        organic: z.array(organicContent),
        metrics: z.array(metricObservation),
      },
      readOnly: true,
      panel: true,
    },
    async (input) => {
      const { mission } = await runtime.open(input.missionId);
      const ads = mission.store.allAds().filter((a) => !input.subjectRef || a.id === input.subjectRef);
      const organic = mission
        .store.allOrganic()
        .filter((o) => !input.subjectRef || o.id === input.subjectRef);
      const metrics = mission.store
        .allMetrics()
        .filter((m) => !input.subjectRef || m.subjectRef === input.subjectRef);
      const audit = mission.store.ingestAudit();
      const newText = audit.filter((e) => e.outcome === 'new').length;
      const dupText = audit.filter((e) => e.outcome === 'duplicate').length;
      const supText = audit.filter((e) => e.outcome === 'superseded').length;
      const text = [
        `Evidence store for ${input.missionId}:`,
        `- ads: ${ads.length} | organic: ${organic.length} | metric observations: ${metrics.length}`,
        `- ingest audit: ${newText} new, ${dupText} duplicates ignored, ${supText} superseded (idempotent ingest, explicit revisions)`,
        '',
        ...ads.map(
          (a) => `- AD ${a.id} from ${a.source.sourceId} v${a.source.connectorVersion} (advertiser ${a.advertiserId}), format ${a.format}`,
        ),
        ...organic.map(
          (o) => `- ORGANIC ${o.id} from ${o.source.sourceId} v${o.source.connectorVersion}, published ${o.publishedAt}, format ${o.format}`,
        ),
        ...metrics.slice(0, 40).map(
          (m) =>
            `- METRIC ${m.subjectRef} ${m.metricKey}=${m.value} observed ${m.observedAt} (${m.source.sourceId}, def ${m.metricDefinition} ${m.metricDefinitionVersion})`,
        ),
        ...(metrics.length > 40 ? [`… ${metrics.length - 40} more metric observations`] : []),
      ].join('\n');
      return {
        text,
        structured: { ads, organic, metrics: metrics.slice(0, 200) },
      };
    },
  );

  // W4 creative handoff tools (same registrar contract).
  registerW4Tools(register, runtime);

  // W5 authorized publishing + W6 measurement & closed-loop learning.
  registerW5Tools(register, runtime);
  registerW6Tools(register, runtime);

  // ---------------------------------------------------------------
  // W3-4 — the workspace panel served as a ui:// resource. The host
  // surface runtime loads it for the plugin's ui.surfaces entry; it is
  // self-contained (no sibling asset reads) and stays far below the
  // host's per-read budget. The panel talks to these same tools.
  // ---------------------------------------------------------------
  server.registerResource(
    'panel',
    PANEL_URI,
    { mimeType: PANEL_MIME },
    async () => ({
      contents: [
        {
          uri: PANEL_URI,
          mimeType: PANEL_MIME,
          text: await panelHtml(),
        },
      ],
    }),
  );

  return server;
}
