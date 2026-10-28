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

export const PLUGIN_NAME = 'marketing';
export const PLUGIN_VERSION = '0.2.0';
export const SERVER_NAME = 'marketing';

const textResult = (text: string, structuredContent?: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text }],
  ...(structuredContent ? { structuredContent } : {}),
});

const PLATFORM_HINT =
  "Only platforms with a verified connector may be researched (MARKETING-DATA-SOURCES.md). 'youtube' is verified via keyless public routes; 'tiktok'/'meta' require the W1-3(b) ad-source decision first.";
const MODE_HINT =
  "researchMode 'demo' additionally ingests the labeled synthetic fixtures (connector:sample) so the full paid x organic loop works end to end; 'live' uses verified sources only — the paid side is an explicit coverage gap until W1-3(b) closes.";

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
  note: z.string(),
};

export function createMarketingServer(runtime: MarketingRuntime): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: PLUGIN_VERSION });

  const register = <In extends z.ZodRawShape, Out extends z.ZodRawShape>(
    name: string,
    config: {
      description: string;
      input: In;
      output: Out;
      readOnly: boolean;
    },
    execute: (
      input: z.infer<z.ZodObject<In>>,
    ) => Promise<{ text: string; structured: z.infer<z.ZodObject<Out>> }>,
  ) => {
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.input,
        outputSchema: config.output,
        annotations: {
          readOnlyHint: config.readOnly,
          destructiveHint: false,
          idempotentHint: config.readOnly,
        },
      },
      (async (input: z.infer<z.ZodObject<In>>) => {
        try {
          const { text, structured } = await execute(input);
          return textResult(text, structured as Record<string, unknown>);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code =
            error instanceof z.ZodError
              ? 'invalid_input'
              : error instanceof MarketingToolError
                ? error.code
                : 'marketing_failure';
          if (code === 'marketing_failure') {
            process.stderr.write(`[${SERVER_NAME}] ${name}: ${String(error)}\n`);
          }
          return {
            isError: true,
            ...textResult(`[${code}] ${message}`, { error: { code, message } }),
          };
        }
      }) as never,
    );
  };

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
      const { mission } = await runtime.open(input.missionId);
      const ads = input.subjectRefs
        ? mission.store.allAds().filter((a) => input.subjectRefs!.includes(a.id))
        : mission.store.allAds();
      const organic = input.subjectRefs
        ? mission.store.allOrganic().filter((o) => input.subjectRefs!.includes(o.id))
        : mission.store.allOrganic();
      if (ads.length + organic.length === 0) {
        throw new MarketingToolError(
          'nothing_to_analyze',
          'no observed ads or organic content in the store — run marketing_research_platform first',
        );
      }
      const adFeatures = await mission.extractFeatures(ads);
      const organicFeatures = await mission.extractFeatures(organic);
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
        'Rank cross-source creative opportunities (Stages C+D): objective-appropriate performance signals over comparable windows, then the paid x organic intersection with SEPARATED observed / cross-source / predicted / confidence scores and contrary evidence. In live mode the paid side is an explicit gap until a verified ad source connects (W1-3(b)); use demo mode to exercise the full intersection.',
      input: { missionId: z.string().min(1) },
      output: { opportunities: z.array(z.object(opportunityScoreShape)) },
      readOnly: true,
    },
    async (input) => {
      const { entry, mission } = await runtime.open(input.missionId);
      if (mission.store.allAds().length === 0) {
        throw new MarketingToolError(
          'paid_source_gap',
          `no ad observations in this mission — the paid x organic intersection needs a verified ad-intelligence source, which is blocked on credentials (W1-3(b), see MARKETING-DATA-SOURCES.md). Current mode '${entry.researchMode}': in demo mode the labeled synthetic fixtures provide the paid side.`,
        );
      }
      const adFeatures = await mission.extractFeatures(mission.store.allAds());
      const organicFeatures = await mission.extractFeatures(mission.store.allOrganic());
      const opportunities: OpportunityScore[] = await mission.rankOpportunities(adFeatures, organicFeatures);
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
    },
    async (input) => {
      const { entry, mission } = await runtime.open(input.missionId);
      const coverage = mission.store.latestCoverage();
      const competitors = entry.competitors;
      const signals = mission.performanceSignals([
        ...mission.store.allAds().map((a) => a.id),
        ...mission.store.allOrganic().map((o) => o.id),
      ]);
      let opportunities: OpportunityScore[] = [];
      let opportunityNote =
        'No ranked opportunities: the paid x organic intersection needs a verified ad-intelligence source — blocked on credentials (W1-3(b)). Run in demo mode to see the loop with labeled synthetic fixtures.';
      let extractionModelRefs: string[] = [];
      if (mission.store.allAds().length > 0) {
        const adFeatures = await mission.extractFeatures(mission.store.allAds());
        const organicFeatures = await mission.extractFeatures(mission.store.allOrganic());
        extractionModelRefs = [...new Set([...adFeatures, ...organicFeatures].map((f) => f.extractionModelRef))];
        opportunities = await mission.rankOpportunities(adFeatures, organicFeatures);
        opportunityNote = '';
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
        ...signals.map((s) => `- ${s.subjectRef}: ${s.note}${s.total !== undefined ? ` (latest ${s.total})` : ''}`),
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
          ? '- Ad intelligence: no verified source connected yet (W1-3(b) open blocker).'
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
          signals,
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

  return server;
}
