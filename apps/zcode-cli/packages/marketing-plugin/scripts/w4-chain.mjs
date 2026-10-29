// W4 creative-handoff evidence: drives the FULL production handoff through a
// real stdio MCP server process — recommendation → handoff pack (brief, timed
// script, storyboard, generator prompt packs, experiment spec) → explicit
// review/approval → produce → bring back (chunked import + declaration) →
// versioned rubric validation → comparison — and prints a transcript for
// docs/marketing/evidence/<date>-w4-creative-handoff.txt.
//
// Run from the plugin package: pnpm demo:w4   (builds dist first)
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const assert = (cond, label) => {
  if (!cond) {
    console.error(`GATE FAILED: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✔ ${label}`);
  }
};

const serverPath = fileURLToPath(new URL('../dist/server.mjs', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'w4-chain-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
});
const client = new Client({ name: 'w4-chain-evidence', version: '0.0.0' });
await client.connect(transport);
console.log(`Connected to marketing MCP server (${serverPath})`);
console.log(`Workspace: ${workspace}\n`);

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  return { isError: result.isError === true, text, structured: result.structuredContent };
};

const section = (title) => console.log(`\n== ${title} ==`);
const show = (text, limit = 2400) =>
  console.log(text.length > limit ? `${text.slice(0, limit)}\n… [truncated]` : text);

try {
  // ---- 1..3. Research chain (W3 tools) up to ranked opportunities.
  section('1. mission start + discovery + research + rank (W3 chain, demo mode)');
  await call('marketing_mission_start', {
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers, 25-40',
    country: 'US',
    platform: 'youtube',
    offer: '30-day home trial, free shipping',
    objective: 'sales',
    constraints: ['no discount-first messaging'],
    researchMode: 'demo',
    missionId: 'mission-w4-chain',
  });
  await call('marketing_discover_competitors', {
    missionId: 'mission-w4-chain',
    hints: ['RivalOne', 'RivalTwo'],
    confirm: ['RivalOne', 'RivalTwo'],
  });
  await call('marketing_research_platform', { missionId: 'mission-w4-chain' });
  const rank = await call('marketing_rank_opportunities', { missionId: 'mission-w4-chain' });
  assert(!rank.isError, 'ranked opportunities produced (hypotheses persisted with ids)');
  const hypothesisId = rank.structured.opportunities[0].hypothesis.id;
  console.log(`  top hypothesis: ${hypothesisId}`);

  // ---- 4. Draft the handoff pack.
  section('2. marketing_draft_creative (the W4 production handoff pack)');
  const draft = await call('marketing_draft_creative', { missionId: 'mission-w4-chain' });
  assert(!draft.isError, 'handoff pack drafted and persisted (review status)');
  const artifact = draft.structured.artifact;
  assert(artifact.kindOf === 'promptPack' && artifact.status === 'review', 'pack is a review-status prompt pack');
  const brief = artifact.brief;
  assert(brief.script?.length === 4, 'timed script: 4 beats');
  assert(brief.script[0].endSec <= 3, 'opening beat lands within 3 seconds');
  assert(brief.generatorPromptPacks?.videoGen?.prompt?.includes('Hook:'), 'video-gen prompt pack present');
  assert(brief.generatorPromptPacks?.thumbnail?.prompt, 'thumbnail prompt pack present');
  assert(brief.generatorPromptPacks?.copy?.titleVariants?.length >= 2, 'copy variants present');
  assert(brief.experimentSpec?.metric === 'attributedConversions', 'experiment spec bound to the objective metric');
  assert(typeof brief.draftedBy === 'string' && brief.draftedBy.length > 0, 'drafting provenance recorded');
  show(draft.text, 1600);

  // ---- 5. Explicit review + approval.
  section('3. marketing_review_artifact (explicit approval)');
  const badApprove = await call('marketing_review_artifact', {
    missionId: 'mission-w4-chain',
    artifactId: artifact.id,
    decision: 'approve',
    reviewedBy: 'marketing lead',
  });
  assert(!badApprove.isError && badApprove.structured.artifact.status === 'approved', 'approval records reviewer and flips status');
  const double = await call('marketing_review_artifact', {
    missionId: 'mission-w4-chain',
    artifactId: artifact.id,
    decision: 'approve',
    reviewedBy: 'marketing lead',
  });
  assert(double.isError && double.text.includes('invalid_transition'), 'double-approval refused (invalid transition)');

  // ---- 6. Produce + bring back: chunked import.
  section('4. marketing_asset_import_begin/write/finish (bring the produced file back)');
  const bytes = Buffer.from('W4-gate-fixture-asset-bytes-0123456789');
  const begin = await call('marketing_asset_import_begin', {
    missionId: 'mission-w4-chain',
    name: 'launch-ad-v1.mp4',
    size: bytes.byteLength,
  });
  assert(!begin.isError, 'import session begun');
  const importId = begin.structured.id;
  // Two chunks, out of order offsets, both land at their positions.
  const half = Math.floor(bytes.byteLength / 2);
  await call('marketing_asset_import_write', {
    id: importId,
    offset: half,
    data: bytes.subarray(half).toString('base64'),
  });
  await call('marketing_asset_import_write', {
    id: importId,
    offset: 0,
    data: bytes.subarray(0, half).toString('base64'),
  });
  const finish = await call('marketing_asset_import_finish', { id: importId });
  assert(!finish.isError, 'import finished with declared byte count verified');
  assert(finish.structured.path.startsWith('.zcode/marketing/missions/mission-w4-chain/assets/'), 'file stored under the mission workspace (relative path)');
  show(finish.text);
  // A mismatched import aborts honestly.
  const bad = await call('marketing_asset_import_begin', { missionId: 'mission-w4-chain', name: 'bad.bin', size: 64 });
  await call('marketing_asset_import_write', { id: bad.structured.id, offset: 0, data: Buffer.from('tiny').toString('base64') });
  const badFinish = await call('marketing_asset_import_finish', { id: bad.structured.id });
  assert(badFinish.isError && badFinish.text.includes('declared 64 bytes'), 'byte-count mismatch aborts the import');

  // ---- 7. Record + rubric validation.
  section('5. marketing_record_asset (declaration + versioned rubric)');
  const record = await call('marketing_record_asset', {
    missionId: 'mission-w4-chain',
    artifactId: artifact.id,
    importedAssetId: importId,
    format: 'video',
    durationSec: 28,
    aspectRatio: '9:16',
    hookText: 'Cafe-grade espresso on your commute — no machine needed',
    proofText: 'unedited before/after of the extraction',
    ctaText: 'Get yours with the 30-day trial',
    transcriptOrCopy:
      'Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot, tested in our survey. Get yours with the 30-day trial.',
  });
  assert(!record.isError, 'asset recorded against the approved pack');
  const rubric = record.structured.rubric;
  assert(rubric.rubricVersion === 'v1', 'rubric version travels with the report');
  assert(rubric.verdict === 'ready' && rubric.score === 1, 'clean declaration passes every machine aspect');
  assert(rubric.checks.some((c) => c.id === 'file-present' && c.severity === 'pass'), 'imported file verified by the rubric');
  assert(rubric.assessedBy.length > 0, 'qualitative provenance recorded (assessedBy)');
  show(record.text, 2600);

  // A rubric-blocked second asset (discount copy against the constrained brief).
  const badRecord = await call('marketing_record_asset', {
    missionId: 'mission-w4-chain',
    artifactId: artifact.id,
    format: 'video',
    durationSec: 28,
    aspectRatio: '9:16',
    hookText: 'Espresso anywhere',
    proofText: 'before/after demo',
    ctaText: 'Buy now',
    transcriptOrCopy: 'Espresso anywhere. 50% off today only — limited offer! Buy now.',
  });
  assert(badRecord.structured.rubric.verdict === 'blocked', 'discount copy against the constrained brief is rubric-blocked');

  // ---- 8. Comparison.
  section('6. marketing_compare_assets (honest comparison)');
  const compare = await call('marketing_compare_assets', { missionId: 'mission-w4-chain' });
  assert(!compare.isError, 'comparison produced');
  assert(compare.structured.comparisons.length === 2, 'both recorded assets compared');
  assert(
    compare.structured.comparisons.some((c) => c.rubricVerdict === 'ready') &&
      compare.structured.comparisons.some((c) => c.rubricVerdict === 'blocked'),
    'ready vs blocked outcomes side by side',
  );
  show(compare.text);

  // ---- 9. Persistence across a fresh server process.
  section('7. persistence: fresh server process reads the creative state');
  await client.close();
  const client2 = new Client({ name: 'w4-chain-evidence-2', version: '0.0.0' });
  const transport2 = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
  });
  await client2.connect(transport2);
  const call2 = async (name, args) => {
    const result = await client2.callTool({ name, arguments: args });
    const text = (result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
    return { isError: result.isError === true, text, structured: result.structuredContent };
  };
  const list = await call2('marketing_list_artifacts', { missionId: 'mission-w4-chain' });
  assert(!list.isError, 'creative state readable after restart');
  assert(list.structured.hypotheses.some((h) => h.id === hypothesisId), 'hypothesis ids stable across processes');
  assert(
    list.structured.artifacts.some((a) => a.kindOf === 'promptPack' && a.status === 'approved'),
    'approved pack persisted',
  );
  assert(list.structured.artifacts.filter((a) => a.kindOf === 'uploadedAsset').length === 2, 'both recorded assets persisted');
  const reDraft = await call2('marketing_draft_creative', {
    missionId: 'mission-w4-chain',
    hypothesisId,
  });
  assert(!reDraft.isError, 'drafting by persisted hypothesis id works after restart');
  await client2.close();

  // Artifacts file on disk.
  const raw = JSON.parse(
    await readFile(join(workspace, '.zcode', 'marketing', 'missions', 'mission-w4-chain-artifacts.json'), 'utf8'),
  );
  assert(raw.kind === 'marketing-mission-artifacts' && raw.version === 1, 'artifacts file is the canonical persisted state');
} finally {
  console.log('');
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
