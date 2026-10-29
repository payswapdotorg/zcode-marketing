// W6 measurement & closed-loop-learning evidence: opens the measurement
// window after a publication, collects PERMITTED connected-account analytics
// through the local sandbox test endpoint (real YouTube Analytics API v2
// report shapes), and records the observed outcome against the PRESERVED
// forecast — producing the [PROXY]-labeled comparison, the appended
// calibration entry, and the next-experiment recommendation grounded in the
// recorded result. Prints a transcript for
// docs/marketing/evidence/<date>-w6-closed-loop.txt.
//
// Run from the plugin package: pnpm demo:w6   (builds dist first)
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const assert = (cond, label, detail) => {
  if (!cond) {
    console.error(`GATE FAILED: ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✔ ${label}`);
  }
};

const serverPath = fileURLToPath(new URL('../dist/server.mjs', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'w6-chain-'));
const SANDBOX_TOKEN = 'sandbox-test-token-DO-NOT-ECHO-w6';

// The sandbox test endpoint — Data API v3 + Analytics API v2 report shapes.
const wire = { uploads: 0, analyticsCalls: 0 };
const ANALYTICS_ROWS = [['2026-10-23', '1200'], ['2026-10-24', '3100'], ['2026-10-25', '5400']];
const sandbox = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body);
  };
  // The resumable session URL is pre-authorized by the init call (the real
  // protocol does not repeat the bearer on the byte PUT) — validate the bearer
  // on every other route exactly like the real endpoint.
  const isSessionUpload = req.method === 'PUT' && url.pathname.startsWith('/upload/resumable/');
  if (!isSessionUpload && req.headers.authorization !== `Bearer ${SANDBOX_TOKEN}`) {
    send(401, JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') {
    wire.uploads += 1;
    send(200, '', { location: `http://127.0.0.1:${sandboxPort}/upload/resumable/session-${wire.uploads}` });
    return;
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/upload/resumable/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => send(201, JSON.stringify({
      id: 'sbvid001',
      snippet: { title: 'sandbox test upload', publishedAt: new Date().toISOString() },
      status: { uploadStatus: 'processed', privacyStatus: 'public' },
    })));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/youtube/v3/videos') {
    send(200, JSON.stringify({
      items: [{
        id: 'sbvid001',
        snippet: { title: 'sandbox test upload', publishedAt: new Date().toISOString() },
        status: { uploadStatus: 'processed', privacyStatus: 'public' },
      }],
    }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/v2/reports') {
    wire.analyticsCalls += 1;
    send(200, JSON.stringify({
      columnHeaders: [
        { name: 'day', columnType: 'DIMENSION', dataType: 'STRING' },
        { name: 'views', columnType: 'METRIC', dataType: 'INTEGER' },
      ],
      rows: ANALYTICS_ROWS,
    }));
    return;
  }
  send(404, JSON.stringify({ error: { message: `no route ${req.method} ${url.pathname}` } }));
});
await new Promise((resolve) => sandbox.listen(0, '127.0.0.1', resolve));
const sandboxPort = sandbox.address().port;
console.log(`Sandbox test endpoint (Data API v3 + Analytics API v2 shapes): http://127.0.0.1:${sandboxPort}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
});
const client = new Client({ name: 'w6-chain-evidence', version: '0.0.0' });
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
  // ---- 1. Chain up to a published, verified post (W3..W5 tools).
  section('1. mission → creative → publish through the connected sandbox account (W3..W5 chain)');
  await call('marketing_mission_start', {
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers, 25-40',
    country: 'US',
    platform: 'youtube',
    offer: '30-day home trial, free shipping',
    objective: 'sales',
    constraints: ['no discount-first messaging'],
    researchMode: 'demo',
    missionId: 'mission-w6-chain',
  });
  await call('marketing_discover_competitors', {
    missionId: 'mission-w6-chain',
    hints: ['RivalOne', 'RivalTwo'],
    confirm: ['RivalOne', 'RivalTwo'],
  });
  await call('marketing_research_platform', { missionId: 'mission-w6-chain' });
  const rank = await call('marketing_rank_opportunities', { missionId: 'mission-w6-chain' });
  const hypothesisId = rank.structured.opportunities[0].hypothesis.id;
  const draft = await call('marketing_draft_creative', { missionId: 'mission-w6-chain' });
  const pack = draft.structured.artifact;
  assert(!draft.isError, 'handoff pack drafted');
  await call('marketing_review_artifact', {
    missionId: 'mission-w6-chain', artifactId: pack.id, decision: 'approve', reviewedBy: 'marketing lead',
  });
  const payload = Buffer.from('w6-evidence-asset-bytes-v1');
  const begin = await call('marketing_asset_import_begin', { missionId: 'mission-w6-chain', name: 'ad-v1.mp4', size: payload.byteLength });
  await call('marketing_asset_import_write', { id: begin.structured.id, offset: 0, data: payload.toString('base64') });
  await call('marketing_asset_import_finish', { id: begin.structured.id });
  const record = await call('marketing_record_asset', {
    missionId: 'mission-w6-chain',
    artifactId: pack.id,
    importedAssetId: begin.structured.id,
    format: 'video',
    durationSec: 28,
    aspectRatio: '9:16',
    hookText: 'Cafe-grade espresso on your commute — no machine needed',
    proofText: 'unedited before/after of the extraction',
    ctaText: 'Get yours with the 30-day trial',
    transcriptOrCopy:
      'Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot, tested in our survey. Get yours with the 30-day trial.',
  });
  await call('marketing_review_artifact', {
    missionId: 'mission-w6-chain', artifactId: record.structured.artifact.id, decision: 'approve', reviewedBy: 'marketing lead',
  });
  const connect = await call('marketing_connect_publish_account', {
    platform: 'youtube',
    label: 'sandbox test channel',
    accessToken: SANDBOX_TOKEN,
    dataBase: `http://127.0.0.1:${sandboxPort}`,
    accountRef: 'UCsandbox00000000000000AA',
    environment: 'sandbox',
    connectedBy: 'worker a',
  });
  assert(!connect.isError, 'sandbox account connected');
  const published = await call('marketing_publish_asset', {
    missionId: 'mission-w6-chain', artifactId: record.structured.artifact.id, approvedBy: 'marketing lead',
  });
  assert(!published.isError, 'asset published through the connected account');
  const pub = published.structured.publication;
  await call('marketing_verify_publication', { missionId: 'mission-w6-chain', publicationId: pub.id });
  show(published.text, 900);

  // ---- 2. Open the measurement window.
  section('2. marketing_open_experiment — the window tests the W4 spec, forecast preserved');
  const opened = await call('marketing_open_experiment', { missionId: 'mission-w6-chain', publicationId: pub.id });
  assert(!opened.isError, 'measurement window opened');
  const experiment = opened.structured.experiment;
  assert(experiment.goalMetricKey === 'attributedConversions', `goal metric bound to the objective (${experiment.goalMetricKey})`);
  assert(experiment.changedVariables.includes('hook'), 'changed variables come from the pack\'s experiment spec');
  assert(experiment.measurementWindowDays === 14, 'window days come from the pack\'s experiment spec');
  assert(experiment.hypothesisId === hypothesisId, 'experiment binds the ranked hypothesis');
  show(opened.text, 1000);
  const reopened = await call('marketing_open_experiment', { missionId: 'mission-w6-chain', publicationId: pub.id });
  assert(reopened.structured.experiment.id === experiment.id, 're-open is idempotent (same experiment)');

  // ---- 3. Collect permitted connected-account analytics.
  section('3. marketing_collect_analytics — permitted daily totals, idempotent ingest');
  const collected = await call('marketing_collect_analytics', {
    missionId: 'mission-w6-chain', publicationId: pub.id, metrics: ['views'],
  });
  assert(!collected.isError, 'connected-account analytics collected');
  assert(collected.structured.observations.length === 3, 'three daily observations');
  assert(collected.structured.latest.some((l) => l.metricKey === 'views' && l.value === 5400), 'latest views = 5400');
  assert(collected.structured.coverage.some((c) => c.note.includes('sandbox')), 'coverage notes the sandbox environment label');
  show(collected.text, 1200);
  const recollect = await call('marketing_collect_analytics', {
    missionId: 'mission-w6-chain', publicationId: pub.id, metrics: ['views'],
  });
  assert(!recollect.isError && recollect.text.includes('duplicates ignored'), 're-collect is idempotent (duplicates ignored)');
  assert(collected.structured.observations.every((o) => o.subjectRef === 'yt:sbvid001'), 'observations carry the post subject ref');
  assert(collected.structured.observations.every((o) => o.metricDefinition === 'connected-account-analytics'), 'metric definition labeled (permitted analytics)');

  // ---- 4. Record the outcome against the PRESERVED forecast.
  section('4. marketing_record_outcome — comparison, calibration, grounded recommendation');
  const hypothesis = (await call('marketing_list_artifacts', { missionId: 'mission-w6-chain' }))
    .structured.hypotheses.find((h) => h.id === hypothesisId);
  assert(hypothesis.predictedOutcome.metricKey === 'attributedConversions', 'preserved forecast metric is the goal metric');
  console.log(`  preserved forecast (verbatim): low ${hypothesis.predictedOutcome.low} / expected ${hypothesis.predictedOutcome.expected} / high ${hypothesis.predictedOutcome.high} on '${hypothesis.predictedOutcome.metricKey}'`);
  // The goal metric is not observable through permitted analytics — a proxy
  // observation REQUIRES its own declared baseline (never the goal metric's
  // range: different units).
  const noBaseline = await call('marketing_record_outcome', {
    missionId: 'mission-w6-chain',
    experimentId: experiment.id,
    observedValue: 5400,
    observedMetricKey: 'views',
  });
  assert(noBaseline.isError && noBaseline.text.includes('proxyForecast'), 'a proxy observation without its declared baseline is refused (no silent unit-mixing)');
  const outcome = await call('marketing_record_outcome', {
    missionId: 'mission-w6-chain',
    experimentId: experiment.id,
    observedValue: 5400,
    observedMetricKey: 'views',
    proxyForecast: { low: 3000, expected: 5000, high: 9000 },
    sourceNote: 'connected-account analytics (sandbox test channel, daily views total — the objective metric is not observable through permitted analytics)',
  });
  assert(!outcome.isError, 'outcome recorded');
  const { comparison, simulation, nextAction, result } = outcome.structured;
  assert(comparison.isProxy === true, 'the comparison carries the [PROXY] label (views ≠ the goal metric)');
  assert(comparison.note.includes('[PROXY]'), 'the note names the proxy explicitly');
  assert(comparison.withinForecastRange === true, 'the comparison runs against the declared PROXY baseline (3000..9000 views), never the goal metric range');
  assert(result.result.forecastPreserved === true, 'the original forecast was preserved verbatim');
  assert(result.result.observedMetricKey === 'views' && result.result.observedValue === 5400, 'the observed value recorded on the observed metric');
  assert(simulation.modelRef === 'calibration:v1', 'calibration model v1');
  assert(simulation.calibrationHistory.length === 1, 'calibration history appended');
  assert(nextAction.recommendation.length > 40, 'a grounded next-experiment recommendation exists');
  assert(nextAction.evidence.some((e) => e.ref.startsWith('outcome-source:')), 'the observation source is recorded as evidence');
  show(outcome.text, 1600);

  // One outcome per experiment — the loop guards blind repeats.
  const again = await call('marketing_record_outcome', {
    missionId: 'mission-w6-chain', experimentId: experiment.id, observedValue: 1,
  });
  assert(again.isError && again.text.includes('already completed'), 'a second outcome on the same experiment is refused');

  // ---- 5. The next draft is grounded in the recorded result (loop closure).
  section('5. the loop closes — next experiment grounded in the recorded result');
  const list = await call('marketing_list_publications', { missionId: 'mission-w6-chain' });
  assert(!list.isError, 'loop state lists the full record');
  show(list.text, 1400);
  const artifactsRaw = JSON.parse(
    await readFile(join(workspace, '.zcode', 'marketing', 'missions', 'mission-w6-chain-artifacts.json'), 'utf8'),
  );
  assert(artifactsRaw.experiments.length === 1 && artifactsRaw.experiments[0].result, 'experiment + result persisted');
  assert(artifactsRaw.simulations.length === 1 && artifactsRaw.simulations[0].calibrationHistory.length === 1, 'calibration history persisted');
  assert(artifactsRaw.nextActions.length === 1, 'next action persisted');
  assert(!JSON.stringify(artifactsRaw).includes(SANDBOX_TOKEN), 'no mission file carries the access token');

  console.log(`\n${process.exitCode ? 'W6 EVIDENCE RUN: GATES FAILED' : 'W6 EVIDENCE RUN: ALL GATES PASSED'}`);
} finally {
  console.log('');
  sandbox.close();
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
