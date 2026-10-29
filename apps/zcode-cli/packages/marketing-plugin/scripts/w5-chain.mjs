// W5 authorized-publishing evidence: drives the publishing wave through a
// REAL spawned stdio MCP server process against a LOCAL SANDBOX TEST
// ENDPOINT speaking the REAL YouTube Data API v3 wire protocol (resumable
// upload session → PUT bytes → videos.list), plus the LIVE keyless oEmbed
// route for the assisted/manual path. Prints a transcript for
// docs/marketing/evidence/<date>-w5-authorized-publishing.txt.
//
// The sandbox test account is exactly what the connection contract describes:
// environment 'sandbox', dataBase pointed at the test endpoint instead of
// googleapis. Every publication it creates is labeled as a test-account post —
// the transcript asserts the label travels.
//
// Run from the plugin package: pnpm demo:w5   (builds dist first)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
const workspace = await mkdtemp(join(tmpdir(), 'w5-chain-'));
const SANDBOX_TOKEN = 'sandbox-test-token-DO-NOT-ECHO-w5';

// ---------------------------------------------------------------------------
// The local sandbox test endpoint — real HTTP, real YouTube Data API v3
// shapes. This is what a connected sandbox test account points dataBase at.
// The bearer token is validated exactly like the real endpoint would.
// ---------------------------------------------------------------------------
const wire = { uploads: 0, inits: 0, byteCounts: [], bearerTokens: new Set(), idemKeys: new Set() };
const sandbox = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body);
  };
  if (req.headers.authorization) wire.bearerTokens.add(req.headers.authorization);
  // The wire log proves the real protocol sequence in the evidence transcript.
  console.log(`  [wire] ${req.method} ${url.pathname}${url.search} (auth ${req.headers.authorization ? 'present' : 'MISSING'})`);
  // The resumable session URL is pre-authorized by the init call (the real
  // protocol does not repeat the bearer on the byte PUT) — validate the bearer
  // on every other route exactly like the real endpoint.
  const isSessionUpload = req.method === 'PUT' && url.pathname.startsWith('/upload/resumable/');
  if (!isSessionUpload && req.headers.authorization !== `Bearer ${SANDBOX_TOKEN}`) {
    send(401, JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
    return;
  }
  if (req.headers['x-idempotency-key']) wire.idemKeys.add(req.headers['x-idempotency-key']);
  if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') {
    wire.inits += 1;
    send(200, '', { location: `http://127.0.0.1:${sandboxPort}/upload/resumable/session-${wire.inits}` });
    return;
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/upload/resumable/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      wire.uploads += 1;
      wire.byteCounts.push(Buffer.concat(chunks).byteLength);
      send(201, JSON.stringify({
        id: 'sbvid001',
        snippet: { title: 'sandbox test upload', publishedAt: new Date().toISOString() },
        status: { uploadStatus: 'processed', privacyStatus: 'public' },
      }));
    });
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
    send(200, JSON.stringify({
      columnHeaders: [
        { name: 'day', columnType: 'DIMENSION', dataType: 'STRING' },
        { name: 'views', columnType: 'METRIC', dataType: 'INTEGER' },
      ],
      rows: [['2026-10-23', '1200'], ['2026-10-24', '3100'], ['2026-10-25', '5400']],
    }));
    return;
  }
  send(404, JSON.stringify({ error: { message: `no route ${req.method} ${url.pathname}` } }));
});
await new Promise((resolve) => sandbox.listen(0, '127.0.0.1', resolve));
const sandboxPort = sandbox.address().port;
console.log(`Sandbox test endpoint (YouTube Data API v3 shapes): http://127.0.0.1:${sandboxPort}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
});
const client = new Client({ name: 'w5-chain-evidence', version: '0.0.0' });
await client.connect(transport);
console.log(`Connected to marketing MCP server (${serverPath})`);
console.log(`Workspace: ${workspace}\n`);

const allToolText = [];
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
  allToolText.push(text, JSON.stringify(result.structuredContent ?? {}));
  return { isError: result.isError === true, text, structured: result.structuredContent };
};

const section = (title) => console.log(`\n== ${title} ==`);
const show = (text, limit = 2400) =>
  console.log(text.length > limit ? `${text.slice(0, limit)}\n… [truncated]` : text);

const produceApprovedAsset = async (missionId, packId, name, payload) => {
  const begin = await call('marketing_asset_import_begin', { missionId, name, size: payload.byteLength });
  const importId = begin.structured.id;
  await call('marketing_asset_import_write', { id: importId, offset: 0, data: payload.toString('base64') });
  await call('marketing_asset_import_finish', { id: importId });
  const record = await call('marketing_record_asset', {
    missionId,
    artifactId: packId,
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
  const asset = record.structured.artifact;
  const approve = await call('marketing_review_artifact', {
    missionId, artifactId: asset.id, decision: 'approve', reviewedBy: 'marketing lead',
  });
  return { asset, approve, importId };
};

try {
  // ---- 1. Research + creative chain up to an approved produced asset.
  section('1. mission + creative chain (W3/W4 tools, demo mode) to an APPROVED produced asset');
  await call('marketing_mission_start', {
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers, 25-40',
    country: 'US',
    platform: 'youtube',
    offer: '30-day home trial, free shipping',
    objective: 'sales',
    constraints: ['no discount-first messaging'],
    researchMode: 'demo',
    missionId: 'mission-w5-chain',
  });
  await call('marketing_discover_competitors', {
    missionId: 'mission-w5-chain',
    hints: ['RivalOne', 'RivalTwo'],
    confirm: ['RivalOne', 'RivalTwo'],
  });
  await call('marketing_research_platform', { missionId: 'mission-w5-chain' });
  await call('marketing_rank_opportunities', { missionId: 'mission-w5-chain' });
  const draft = await call('marketing_draft_creative', { missionId: 'mission-w5-chain' });
  const pack = draft.structured.artifact;
  assert(!draft.isError && pack.kindOf === 'promptPack', 'handoff pack drafted');
  await call('marketing_review_artifact', {
    missionId: 'mission-w5-chain', artifactId: pack.id, decision: 'approve', reviewedBy: 'marketing lead',
  });
  const first = await produceApprovedAsset('mission-w5-chain', pack.id, 'ad-v1.mp4', Buffer.from('w5-evidence-asset-bytes-v1'));
  assert(first.approve.structured.artifact.status === 'approved', 'produced asset approved (W4 gate)');

  // ---- 2. No connected account yet: direct publishing refuses honestly.
  section('2. no connection yet — honest refusals + the assisted handoff package');
  const noConn = await call('marketing_publish_asset', {
    missionId: 'mission-w5-chain', artifactId: first.asset.id, approvedBy: 'marketing lead',
  });
  assert(noConn.isError && noConn.text.includes('auth_required'), 'publish without a connection refuses (auth_required)');
  assert(noConn.text.includes('marketing_assisted_handoff'), 'the refusal points at the assisted path');
  const handoff = await call('marketing_assisted_handoff', { missionId: 'mission-w5-chain', artifactId: first.asset.id });
  assert(!handoff.isError, 'assisted publishing package generated');
  assert(handoff.structured.package.file.bytes === Buffer.byteLength('w5-evidence-asset-bytes-v1'), 'package carries the asset file location');
  assert(handoff.structured.package.steps.some((s) => s.includes('marketing_record_manual_publication')), 'package steps end at the bring-back tool');
  show(handoff.text, 1200);

  // ---- 3. The LIVE keyless verification route (manual path): a real public URL.
  section('3. LIVE keyless oEmbed: recording a manual publication against a REAL public video');
  const REAL_PUBLIC_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const manual = await call('marketing_record_manual_publication', {
    missionId: 'mission-w5-chain',
    artifactId: first.asset.id,
    url: REAL_PUBLIC_URL,
    publishedBy: 'marketing lead',
    notes: 'evidence run: real public URL stands in for the user\'s own upload — the verification path is identical',
  });
  if (!manual.isError && manual.structured.publication.verification?.method === 'public-oembed') {
    assert(manual.structured.publication.status === 'verified', 'manual publication VERIFIED through the LIVE keyless oEmbed route');
    show(manual.text, 800);
  } else if (!manual.isError && manual.structured.publication.verification?.method === 'user-attested') {
    console.log('  ⚠ LIVE oEmbed not resolvable from this network — recorded honestly as user-attested (the fallback IS the honesty gate)');
    show(manual.text, 800);
  } else {
    assert(false, 'manual publication recording failed', manual.text);
  }

  // ---- 4. Connect the sandbox test account (health check first).
  section('4. marketing_connect_publish_account — sandbox test account, health-checked');
  const badConnect = await call('marketing_connect_publish_account', {
    platform: 'youtube',
    label: 'revoked credential',
    accessToken: 'definitely-not-the-token',
    dataBase: `http://127.0.0.1:${sandboxPort}`,
    accountRef: 'UCsandbox00000000000000AA',
    environment: 'sandbox',
    connectedBy: 'worker a',
  });
  assert(badConnect.isError && badConnect.text.includes('auth_required'), 'a failing health check refuses the connection');
  const tiktok = await call('marketing_connect_publish_account', {
    platform: 'tiktok',
    label: 'tiktok brand',
    accessToken: 'whatever',
    dataBase: 'https://tiktok.example.test',
    accountRef: '@brand',
    environment: 'production',
    connectedBy: 'worker a',
  });
  assert(tiktok.isError && tiktok.text.includes('invalid_input'), 'unverified platform connectors refuse (data-sources ledger)');
  const connect = await call('marketing_connect_publish_account', {
    platform: 'youtube',
    label: 'sandbox test channel',
    accessToken: SANDBOX_TOKEN,
    dataBase: `http://127.0.0.1:${sandboxPort}`,
    accountRef: 'UCsandbox00000000000000AA',
    environment: 'sandbox',
    connectedBy: 'worker a',
  });
  assert(!connect.isError && connect.structured.connection.environment === 'sandbox', 'sandbox test account connected and labeled');
  assert(!('accessToken' in (connect.structured.connection ?? {})), 'connection view carries no token');

  // ---- 5. Publish through the connected account — idempotently.
  section('5. marketing_publish_asset — resumable upload through the connected account');
  const second = await produceApprovedAsset('mission-w5-chain', pack.id, 'ad-v2.mp4', Buffer.from('w5-evidence-asset-bytes-v2'));
  assert(second.approve.structured.artifact.status === 'approved', 'second produced asset approved');
  const published = await call('marketing_publish_asset', {
    missionId: 'mission-w5-chain', artifactId: second.asset.id, approvedBy: 'marketing lead', privacyStatus: 'public',
  });
  assert(!published.isError, 'publish through the connected account succeeded', published.text);
  const pub = published.structured.publication;
  assert(pub.externalPostId === 'sbvid001', `post identity recorded (${pub.externalPostId})`);
  assert(pub.url === 'https://www.youtube.com/watch?v=sbvid001', 'post URL recorded');
  assert(pub.environment === 'sandbox', 'publication carries the SANDBOX label from the connection');
  assert(pub.connectionId === connect.structured.connection.connectionId, 'publication records the connection id');
  assert(pub.assistedHandoff === false, 'direct publication (not assisted)');
  show(published.text, 1000);
  assert(wire.uploads === 1, `exactly one wire upload (got ${wire.uploads})`);
  assert(wire.bearerTokens.has(`Bearer ${SANDBOX_TOKEN}`), 'the upload authorized with the stored token');
  assert(pub.idempotencyKey === `${second.asset.id}:mission-w5-chain:organic`, 'idempotency key derived from the artifact');

  // ---- 6. Idempotent replay — the same publication, no duplicate post.
  section('6. retry publish — idempotent replay');
  const replay = await call('marketing_publish_asset', {
    missionId: 'mission-w5-chain', artifactId: second.asset.id, approvedBy: 'marketing lead',
  });
  assert(!replay.isError && replay.structured.idempotentReplay === true, 'replay returns the SAME publication (idempotentReplay)');
  assert(replay.structured.publication.id === pub.id, 'same publication id');
  assert(wire.uploads === 1, `no second upload on the wire (still ${wire.uploads})`);

  // ---- 7. Post-status verification through the connected account.
  section('7. marketing_verify_publication — connected-account verification');
  const verify = await call('marketing_verify_publication', { missionId: 'mission-w5-chain', publicationId: pub.id });
  assert(!verify.isError, 'verification call succeeded');
  assert(verify.structured.publication.status === 'verified', 'publication status flips to verified');
  assert(verify.structured.publication.verification.method === 'connected-account', 'verification method recorded (videos.list route)');
  show(verify.text, 900);

  // ---- 8. The loop state view + persistence across a fresh server process.
  section('8. loop state + persistence (fresh server process)');
  const loop = await call('marketing_list_publications', { missionId: 'mission-w5-chain' });
  assert(!loop.isError, 'loop state lists publications');
  assert(loop.structured.publications.length === 2, 'both publications persisted (manual + connected)');
  show(loop.text, 1200);
  await client.close();
  const client2 = new Client({ name: 'w5-chain-evidence-2', version: '0.0.0' });
  const transport2 = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
  });
  await client2.connect(transport2);
  const call2 = async (name, args) => {
    const result = await client2.callTool({ name, arguments: args });
    const text = (result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
    allToolText.push(text, JSON.stringify(result.structuredContent ?? {}));
    return { isError: result.isError === true, text, structured: result.structuredContent };
  };
  const connections2 = await call2('marketing_list_connections', {});
  assert(!connections2.isError && connections2.structured.connections.length === 1, 'connected account persisted across restart');
  assert(connections2.structured.connections[0].environment === 'sandbox', 'sandbox label persisted');
  const loop2 = await call2('marketing_list_publications', { missionId: 'mission-w5-chain' });
  assert(!loop2.isError && loop2.structured.publications.some((p) => p.externalPostId === 'sbvid001' && p.status === 'verified'),
    'publication identity + verified status persisted across restart');
  await client2.close();

  // ---- 9. Auth hygiene: the token never left the credential area.
  section('9. auth hygiene (grep-enforced)');
  const transcriptLeak = allToolText.filter((chunk) => chunk.includes(SANDBOX_TOKEN));
  assert(transcriptLeak.length === 0, 'no tool output ever echoed the access token');
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full)));
      else files.push(full);
    }
    return files;
  };
  let tokenFiles = [];
  for (const file of await walk(join(workspace, '.zcode'))) {
    if (file.endsWith('connections.json')) continue; // the credential area, by design
    if ((await readFile(file, 'utf8')).includes(SANDBOX_TOKEN)) tokenFiles.push(file);
  }
  assert(tokenFiles.length === 0, `no mission file carries the token (${tokenFiles.join(', ')})`);
  const raw = JSON.parse(
    await readFile(join(workspace, '.zcode', 'marketing', 'connections.json'), 'utf8'),
  );
  assert(raw.kind === 'marketing-connections' && raw.connections.length === 1, 'connections.json is the canonical credential store');
  assert(raw.connections[0].environment === 'sandbox' && raw.connections[0].dataBase.includes('127.0.0.1'), 'the stored connection points at the sandbox test endpoint');

  console.log(`\n${process.exitCode ? 'W5 EVIDENCE RUN: GATES FAILED' : 'W5 EVIDENCE RUN: ALL GATES PASSED'}`);
} finally {
  console.log('');
  sandbox.close();
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
