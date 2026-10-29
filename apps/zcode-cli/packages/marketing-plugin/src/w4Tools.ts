/**
 * W4 tools — creative strategy and production handoff (see docs/marketing/):
 * the user takes a recommendation into a creative platform (the generator
 * prompt packs), produces an asset, and brings it back into the SAME mission
 * (chunked import -> declaration + versioned rubric -> comparison). Approval
 * is explicit; the rubric suggests, never edits. Registered through the same
 * tool-registrar contract as the W3 tools.
 */
import { z } from 'zod';
import { creativeArtifact, creativeHypothesis } from '@zcode/marketing';
import type { AssetDeclaration, CreativeArtifact as CreativeArtifactRecord, RubricReport } from '@zcode/marketing';
import { MarketingToolError, type MarketingRuntime } from './runtime.js';
import type { ToolRegistrar } from './toolRegistrar.js';

/** Rubric report stored inside an uploadedAsset artifact's brief, if validated. */
const artifactRubric = (artifact: CreativeArtifactRecord): RubricReport | undefined =>
  (artifact.brief as { rubric?: RubricReport }).rubric;

/** Uploaded assets have no store observations yet — the signal subject is the artifact itself. */
const artifactSignalSubject = (artifact: CreativeArtifactRecord): string => artifact.id;

/** Rubric check/report output shapes (mirror the domain rubric types). */
const rubricCheckShape = z.object({
  id: z.string(),
  aspect: z.string(),
  severity: z.enum(['pass', 'warn', 'fail']),
  message: z.string(),
  suggestion: z.string().optional(),
});
const rubricReportShape = z.object({
  rubricVersion: z.string(),
  checks: z.array(rubricCheckShape),
  score: z.number(),
  verdict: z.enum(['ready', 'needs-review', 'blocked']),
  assessedBy: z.string(),
});

export function registerW4Tools(register: ToolRegistrar, runtime: MarketingRuntime): void {
// ---------------------------------------------------------------
// W4 — Creative strategy and production handoff.
// The user takes a recommendation into a creative platform (the generator
// prompt packs), produces an asset, and brings it back into the SAME
// mission: import (chunked, panel-driven) -> record + rubric validation
// -> comparison. Approval is explicit; the rubric suggests, never edits.
// ---------------------------------------------------------------
register(
  'marketing_draft_creative',
  {
    description:
      'Draft the W4 production handoff pack for a ranked opportunity: creative brief, timed script, storyboard beats, generator-specific prompt packs (video-gen / thumbnail / copy variants), and the testable experiment spec. Omit hypothesisId to draft the top-ranked opportunity. The pack is persisted as a CreativeArtifact in review status — approve or reject it with marketing_review_artifact, then produce the asset and bring it back with marketing_asset_import_* + marketing_record_asset.',
    input: {
      missionId: z.string().min(1),
      hypothesisId: z.string().optional().describe('The ranked hypothesis to draft for; defaults to the top-ranked one.'),
    },
    output: { artifact: creativeArtifact },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    if (loaded.artifacts.hypotheses.length === 0) {
      throw new MarketingToolError(
        'nothing_to_draft',
        'no ranked hypotheses in this mission yet — run marketing_rank_opportunities (which persists them) before drafting',
      );
    }
    const hypothesis = input.hypothesisId
      ? await runtime.findHypothesis(input.missionId, input.hypothesisId)
      : loaded.artifacts.hypotheses[0];
    const artifact = await loaded.mission.draftCreative(hypothesis);
    await runtime.saveArtifact(input.missionId, artifact);
    const brief = artifact.brief as Record<string, unknown>;
    const text = [
      `Creative handoff pack drafted (${artifact.id}) for hypothesis ${hypothesis.id}:`,
      `- angle: ${hypothesis.pattern.message}`,
      `- hook: "${hypothesis.pattern.hook}" | format: ${hypothesis.pattern.format}`,
      `- drafted by: ${String(brief.draftedBy)} (routing provenance recorded in the artifact)`,
      '',
      'The pack contains the timed script (4 beats), storyboard, video-gen + thumbnail prompt packs,',
      'copy variants and the experiment spec. Review it in the Marketing panel or with',
      'marketing_list_artifacts; approve with marketing_review_artifact before producing/publishing.',
    ].join('\n');
    return { text, structured: { artifact } };
  },
);

register(
  'marketing_list_artifacts',
  {
    description:
      'List the mission creative state (W4): persisted ranked hypotheses and every creative artifact (prompt packs, uploaded assets) with status, hypothesis linkage, and rubric reports where an asset was validated.',
    input: { missionId: z.string().min(1) },
    output: {
      hypotheses: z.array(creativeHypothesis),
      artifacts: z.array(creativeArtifact),
    },
    readOnly: true,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const text = [
      `Creative state for ${input.missionId}:`,
      `- hypotheses: ${loaded.artifacts.hypotheses.length} ranked`,
      `- artifacts: ${loaded.artifacts.artifacts.length}`,
      ...loaded.artifacts.artifacts.map(
        (a) =>
          `- ${a.id} [${a.kindOf}/${a.status}] for hypothesis ${a.hypothesisId}${(a.brief as { rubric?: { verdict?: string } }).rubric ? ` — rubric ${(a.brief as { rubric: { verdict: string } }).rubric.verdict}` : ''}`,
      ),
    ].join('\n');
    return { text, structured: { hypotheses: loaded.artifacts.hypotheses, artifacts: loaded.artifacts.artifacts } };
  },
);

register(
  'marketing_review_artifact',
  {
    description:
      'Review a creative artifact (W4): approve or reject it. Approval is EXPLICIT — the status gates publishing (W5) and nothing auto-approves. Record the reviewer and optional notes; both travel with the artifact.',
    input: {
      missionId: z.string().min(1),
      artifactId: z.string().min(1),
      decision: z.enum(['approve', 'reject']),
      reviewedBy: z.string().min(1).max(200).describe('Who reviewed (user name or role) — recorded on the artifact.'),
      notes: z.string().max(2000).optional().describe('Optional review notes, e.g. what to change before re-submission.'),
    },
    output: { artifact: creativeArtifact },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const artifact = await runtime.getArtifact(input.missionId, input.artifactId);
    if (artifact.status !== 'review' && artifact.status !== 'rejected') {
      throw new MarketingToolError(
        'invalid_transition',
        `artifact ${input.artifactId} is '${artifact.status}' — only review (or rejected, for re-review) artifacts can be ${input.decision}d`,
      );
    }
    const next: typeof artifact = {
      ...artifact,
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      approvedBy: input.decision === 'approve' ? input.reviewedBy : undefined,
      brief: {
        ...(artifact.brief as Record<string, unknown>),
        review: {
          decision: input.decision,
          reviewedBy: input.reviewedBy,
          at: new Date().toISOString(),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      },
    };
    await runtime.saveArtifact(input.missionId, next);
    const text = [
      `Artifact ${input.artifactId} ${input.decision === 'approve' ? 'APPROVED' : 'REJECTED'} by ${input.reviewedBy}.`,
      input.decision === 'approve'
        ? 'Publishing (W5) requires this approval; the next step is producing the asset and bringing it back with marketing_record_asset.'
        : 'Update the asset/pack and re-draft or re-record for a new review round.',
    ].join('\n');
    return { text, structured: { artifact: next } };
  },
);

register(
  'marketing_asset_import_begin',
  {
    description: 'Begin a chunked asset import into the mission workspace (W4 bring-back). Panel-driven; call marketing_record_asset with the returned id afterwards.',
    input: {
      missionId: z.string().min(1),
      name: z.string().min(1).max(300),
      size: z.number().int().positive().max(512 * 1024 * 1024),
    },
    output: { id: z.string() },
    readOnly: false,
  },
  async (input) => {
    const { id } = await runtime.beginAssetImport(input);
    return { text: `Import ${id} begun for ${input.name} (${input.size} bytes).`, structured: { id } };
  },
);

register(
  'marketing_asset_import_write',
  {
    description: 'Write one base64 chunk of an in-flight asset import at a byte offset.',
    input: {
      id: z.string().min(1),
      offset: z.number().int().min(0),
      data: z.string().min(1).max(8 * 1024 * 1024),
    },
    output: { received: z.number() },
    readOnly: false,
  },
  async (input) => {
    await runtime.writeAssetChunk(input.id, input.offset, input.data);
    return { text: 'chunk written', structured: { received: input.offset } };
  },
);

register(
  'marketing_asset_import_finish',
  {
    description: 'Finish an asset import; verifies the received byte count matches the declaration and returns the stored file (name/bytes/workspace-relative path).',
    input: { id: z.string().min(1) },
    output: { name: z.string(), bytes: z.number(), path: z.string() },
    readOnly: false,
  },
  async (input) => {
    const file = await runtime.finishAssetImport(input.id);
    return {
      text: `Import complete: ${file.name} (${file.bytes} bytes) at ${file.path}. Record it against an artifact with marketing_record_asset.`,
      structured: file,
    };
  },
);

register(
  'marketing_record_asset',
  {
    description:
      'Bring a produced asset back into the mission (W4 gate): declare what the asset contains (opening/hook, proof, CTA, transcript/copy, format/duration/aspect) and reference an imported file (from marketing_asset_import_finish) if the user imported one. Runs the versioned validation rubric (deterministic rule checks + routed qualitative assessment with provenance) and records everything as a CreativeArtifact linked to the hypothesis. The rubric SUGGESTS corrections — it never edits the creative or auto-approves.',
    input: {
      missionId: z.string().min(1),
      artifactId: z.string().min(1).describe('The prompt-pack artifact this asset was produced from.'),
      importedAssetId: z.string().min(1).optional().describe('Import id from marketing_asset_import_finish.'),
      format: z.enum(['video', 'image']),
      durationSec: z.number().positive().optional(),
      aspectRatio: z.string().min(1).optional(),
      hookText: z.string().max(2000).describe('The opening line / first on-screen text of the asset.'),
      proofText: z.string().max(2000).describe('The demonstration / proof element the asset contains.'),
      ctaText: z.string().max(2000).describe('The closing call to action.'),
      transcriptOrCopy: z.string().max(20000).describe('Full transcript or copy of the asset.'),
    },
    output: { artifact: creativeArtifact, rubric: rubricReportShape },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const pack = await runtime.getArtifact(input.missionId, input.artifactId);
    const file = input.importedAssetId
      ? await runtime.resolveImportedAsset(input.missionId, input.importedAssetId)
      : undefined;
    const declaration: AssetDeclaration = {
      format: input.format,
      ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
      hookText: input.hookText,
      proofText: input.proofText,
      ctaText: input.ctaText,
      transcriptOrCopy: input.transcriptOrCopy,
      ...(file ? { file } : {}),
    };
    const rubric = await loaded.mission.validateAsset({
      declaration,
      competitors: loaded.entry.competitors,
    });
    const artifact = creativeArtifact.parse({
      kind: 'CreativeArtifact',
      id: `asset-${pack.id}-${Date.now()}`,
      missionId: input.missionId,
      hypothesisId: pack.hypothesisId,
      kindOf: 'uploadedAsset',
      status: 'review',
      brief: {
        producedFrom: pack.id,
        declaration,
        rubric,
        importedAt: new Date().toISOString(),
      },
      promptPack: {},
    });
    await runtime.saveArtifact(input.missionId, artifact);
    const failed = rubric.checks.filter((c) => c.severity === 'fail');
    const warned = rubric.checks.filter((c) => c.severity === 'warn');
    const text = [
      `Asset recorded (${artifact.id}) against artifact ${pack.id}, hypothesis ${pack.hypothesisId}.`,
      `Rubric ${rubric.rubricVersion}: verdict '${rubric.verdict}', score ${rubric.score} — ${failed.length} blocking, ${warned.length} to review.`,
      ...rubric.checks.map((c) => `- [${c.severity}] ${c.id}: ${c.message}${c.suggestion ? ` → ${c.suggestion}` : ''}`),
      '',
      `Qualitative assessment provenance: ${rubric.assessedBy}.`,
      failed.length > 0
        ? 'Fix the blocking issues and record a new asset version; approval stays gated on review.'
        : 'Review the warnings, then approve or reject with marketing_review_artifact.',
    ].join('\n');
    return { text, structured: { artifact, rubric } };
  },
);

register(
  'marketing_compare_assets',
  {
    description:
      'Compare the assets recorded against one hypothesis (or all): rubric verdicts and scores side by side, plus the observed performance signals where the mission has them — the honest comparison view before choosing what to publish (W5).',
    input: { missionId: z.string().min(1), hypothesisId: z.string().optional() },
    output: {
      comparisons: z.array(
        z.object({
          artifactId: z.string(),
          hypothesisId: z.string(),
          rubricVerdict: z.string(),
          rubricScore: z.number(),
          checksFailed: z.number(),
          checksWarned: z.number(),
          signalNote: z.string().optional(),
        }),
      ),
    },
    readOnly: true,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const assets = loaded.artifacts.artifacts.filter(
      (a) =>
        a.kindOf === 'uploadedAsset' &&
        (!input.hypothesisId || a.hypothesisId === input.hypothesisId),
    );
    if (assets.length === 0) {
      throw new MarketingToolError(
        'nothing_to_compare',
        `no recorded assets${input.hypothesisId ? ` for hypothesis ${input.hypothesisId}` : ''} — produce an asset and record it with marketing_record_asset`,
      );
    }
    const comparisons = assets.map((asset) => {
      const rubric = artifactRubric(asset);
      const signal = loaded.mission
        .performanceSignals([artifactSignalSubject(asset)])
        .at(0);
      return {
        artifactId: asset.id,
        hypothesisId: asset.hypothesisId,
        rubricVerdict: String(rubric?.verdict ?? 'not-validated'),
        rubricScore: typeof rubric?.score === 'number' ? rubric.score : -1,
        checksFailed: Array.isArray(rubric?.checks) ? rubric.checks.filter((c) => c.severity === 'fail').length : 0,
        checksWarned: Array.isArray(rubric?.checks) ? rubric.checks.filter((c) => c.severity === 'warn').length : 0,
        ...(signal?.note ? { signalNote: signal.note } : {}),
      };
    });
    const text = [
      `Asset comparison (${input.missionId}):`,
      ...comparisons.map(
        (c) =>
          `- ${c.artifactId} [hypothesis ${c.hypothesisId}] rubric ${c.rubricVerdict} (${c.rubricScore}) — ${c.checksFailed} fail / ${c.checksWarned} warn${c.signalNote ? `; signal: ${c.signalNote}` : ''}`,
      ),
      '',
      'Rubric verdicts compare validation quality; performance signals (when present) are objective-appropriate. Choose the asset to publish with marketing_review_artifact + publishing (W5).',
    ].join('\n');
    return { text, structured: { comparisons } };
  },
);

}
