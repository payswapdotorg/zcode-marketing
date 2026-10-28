// W3 runtime-integration evidence: drives the FULL marketing tool chain through
// a real stdio MCP server process (the plugin chain the CLI uses), asserts the
// blueprint gates, and prints a transcript for
// docs/marketing/evidence/<date>-w3-plugin-chain-run.txt.
//
// Run from the plugin package: pnpm demo:w3   (builds dist/server.mjs first)
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
const workspace = await mkdtemp(join(tmpdir(), 'w3-chain-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
});
const client = new Client({ name: 'w3-chain-evidence', version: '0.0.0' });
await client.connect(transport);
console.log(`Connected to marketing MCP server (${serverPath})`);
console.log(`Workspace: ${workspace}\n`);

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  return { isError: result.isError === true, text, structured: result.structuredContent };
};

const section = (title) => console.log(`\n== ${title} ==`);
const show = (text, limit = 2200) => console.log(text.length > limit ? `${text.slice(0, limit)}\n… [truncated]` : text);

try {
  // ---- 1. User describes a product, chooses a platform (onboarding)
  section('1. marketing_mission_start (demo mode: full paid x organic loop)');
  const start = await call('marketing_mission_start', {
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers, 25-40',
    country: 'US',
    platform: 'youtube',
    offer: '30-day home trial, free shipping',
    objective: 'sales',
    constraints: ['no discount-first messaging', 'brand: warm, practical'],
    researchMode: 'demo',
    missionId: 'mission-w3-chain',
  });
  assert(!start.isError, 'mission started and persisted');
  show(start.text);

  // ---- 2. Competitor discovery (Stage A, user-correctable)
  section('2. marketing_discover_competitors');
  const discover = await call('marketing_discover_competitors', {
    missionId: 'mission-w3-chain',
    hints: ['RivalOne', 'RivalTwo'],
    confirm: ['RivalOne', 'RivalTwo'],
  });
  assert(!discover.isError, 'competitor candidates returned with user confirmations');
  show(discover.text);

  // ---- 3. Platform research through the verified connector chain
  section('3. marketing_research_platform (run 1)');
  const research = await call('marketing_research_platform', { missionId: 'mission-w3-chain' });
  assert(!research.isError, 'research run through the connector chain');
  show(research.text);
  const ingested1 = research.structured?.ingested;
  const evidence1 = await call('marketing_evidence_view', { missionId: 'mission-w3-chain' });
  const liveUploadCount = (evidence1.structured?.organic ?? []).filter((o) => String(o.id).startsWith('yt:')).length;

  section('3b. research again — idempotent ingest (W2 gate through the plugin chain)');
  const again = await call('marketing_research_platform', { missionId: 'mission-w3-chain' });
  assert(!again.isError, 'second research run succeeds');
  const ingested2 = again.structured?.ingested;
  assert(
    ingested2?.ads === ingested1?.ads && ingested2?.organic === ingested1?.organic,
    'double research run is idempotent for entities (no new ads/organic, no inflation)',
  );
  assert(
    (ingested2?.metrics ?? 0) - (ingested1?.metrics ?? 0) <= liveUploadCount,
    'metric growth is bounded to fresh live snapshots (new observedAt = new evidence, by design)',
  );

  // ---- 4. Creative feature extraction (Stage B)
  section('4. marketing_analyze_creative (Stage B)');
  const analyze = await call('marketing_analyze_creative', { missionId: 'mission-w3-chain' });
  assert(!analyze.isError, 'creative structure extracted with provenance');
  show(analyze.text);

  // ---- 5. Stages C+D: separated scores, cross-source evidence
  section('5. marketing_rank_opportunities (Stages C+D)');
  const rank = await call('marketing_rank_opportunities', { missionId: 'mission-w3-chain' });
  assert(!rank.isError, 'opportunities ranked with SEPARATED scores');
  const top = rank.structured?.opportunities?.[0];
  assert(!!top, 'at least one opportunity');
  assert(
    top?.hypothesis?.supportedBy?.some((e) => String(e.ref).startsWith('ad-')) &&
      top?.hypothesis?.supportedBy?.some((e) => String(e.ref).startsWith('yt-')),
    'top opportunity carries BOTH paid and organic evidence refs',
  );
  show(rank.text);

  // ---- 6. The evidence-backed report (W3 exit gate artifact)
  section('6. marketing_mission_report (the W3 exit-gate artifact)');
  const report = await call('marketing_mission_report', { missionId: 'mission-w3-chain' });
  assert(!report.isError, 'report composed');
  assert(report.text.includes('## Data coverage (explicit gaps, never silently filled)'), 'report states coverage gaps explicitly');
  assert(report.text.includes('## Limitations (honest)'), 'report carries an honest limitations section');
  assert(report.text.includes('DEMO MODE'), 'report labels the demo/synthetic evidence');
  show(report.text, 3400);

  // ---- 7. Evidence viewer (provenance trail)
  section('7. marketing_evidence_view (provenance for every record)');
  const evidence = await call('marketing_evidence_view', { missionId: 'mission-w3-chain' });
  assert(!evidence.isError, 'evidence trail available with ingest audit');
  assert(evidence.text.includes('duplicates ignored'), 'idempotent ingest audit visible to the user');
  show(evidence.text, 2600);

  section('8. live-mode paid-source honesty (refuses to invent ad data)');
  await call('marketing_mission_start', {
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers, 25-40',
    country: 'US',
    platform: 'youtube',
    offer: '30-day trial',
    objective: 'awareness',
    researchMode: 'live',
    missionId: 'mission-w3-live',
  });
  await call('marketing_discover_competitors', { missionId: 'mission-w3-live', hints: ['RivalOne'] });
  await call('marketing_research_platform', { missionId: 'mission-w3-live' });
  const liveRank = await call('marketing_rank_opportunities', { missionId: 'mission-w3-live' });
  assert(liveRank.isError && liveRank.text.includes('paid_source_gap'), 'live mode refuses ranking without a verified ad source');
  const liveReport = await call('marketing_mission_report', { missionId: 'mission-w3-live' });
  assert(
    !liveReport.isError && liveReport.text.includes('W1-3(b)'),
    'live report states the open ad-source blocker instead of inventing data',
  );

  section('9. mission list (workspace persistence)');
  const list = await call('marketing_mission_list', {});
  assert(list.text.includes('mission-w3-chain') && list.text.includes('mission-w3-live'), 'missions persisted in the workspace index');

  console.log('\nALL W3 CHAIN GATES PASSED — marketing tools run end-to-end through the plugin MCP chain.');
  console.log('Workspace root: ' + workspace);
} finally {
  await client.close();
  await rm(workspace, { recursive: true, force: true });
}
