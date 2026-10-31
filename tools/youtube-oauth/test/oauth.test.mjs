// oauth.test.mjs — WO-P1 credentials-free acceptance suite.
//
// Test names carry the stable identifiers AT-P1.1 … AT-P1.5 so CI output,
// commit messages, and registry entries can reference them unambiguously.
//
// What this suite proves (credentials-free, wire-accurate mock):
//   - the OAuth code path, refresh with rotation, and redaction discipline
//   - the health-check -> production connection record path
//   - idempotent re-authorization
//   - permission-broker denial with zero side effects
//   - degraded-state handling on provider-side revocation
//
// What it deliberately does NOT fake: the real Google consent click with the
// brand's account. That is the TL's recorded manual run per the runbook; the
// registry entry states the split honestly.
//
// Run: node --test --test-reporter=spec "tools/youtube-oauth/test/*.test.mjs"

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAuthUrl,
  createPkce,
  createState,
  exchangeCode,
  refreshAccessToken,
} from '../oauth-client.mjs';
import { loadConfig, PRODUCTION_SCOPES } from '../config.mjs';
import { TokenStore, generateKey } from '../token-store.mjs';
import { completeConsent } from '../connection-record.mjs';
import { healthCheck, runHealthCheckForConnection } from '../health-check.mjs';
import { performUpload } from '../broker-gate.mjs';
import { assertNoSecrets, projectConnection, redactDeep } from '../redact.mjs';
import { startMockGoogle } from '../mock-google.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CLI = join(MODULE_DIR, '..', 'cli.mjs');

const CHANNEL_ID = 'UCmockChannelId0000000000000000';
const CHANNEL_TITLE = 'Brand Test Channel (mock)';

/** Full throwaway fixture: mock Google + temp store + config. */
async function makeFixture() {
  const mock = await startMockGoogle({ channelId: CHANNEL_ID, channelTitle: CHANNEL_TITLE });
  const root = mkdtempSync(join(tmpdir(), 'wo-p1-'));
  const keyfilePath = join(root, 'keyfile');
  const key = generateKey();
  writeFileSync(keyfilePath, key, 'utf8');
  const logs = [];
  const store = new TokenStore({
    path: join(root, 'store.json'),
    key,
    auditPath: join(root, 'store.audit-log.jsonl'),
    logger: { log: (s) => logs.push(s) },
  });
  const cfg = {
    ...loadConfig({ env: {} }),
    ...mock.endpoints,
    clientId: mock.clientId,
    clientSecret: mock.clientSecret,
    redirectUri: `${mock.base}/oauth/callback`,
    scopes: PRODUCTION_SCOPES,
  };
  return {
    mock,
    root,
    key,
    keyfilePath,
    store,
    cfg,
    logs,
    secrets: () => [
      ...logs,                       // every log line
      store.raw(),                   // encrypted store file bytes
      store.auditLog(),              // audit log
      JSON.stringify(mock.stats.consentEvents()), // mock-side consent record
    ],
    cleanup: async () => {
      await mock.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Simulate the browser leg: open the auth URL, follow the redirect, return the code. */
async function simulateBrowserConsent(cfg) {
  const pkce = createPkce();
  const state = createState();
  const url = buildAuthUrl(cfg, { state, codeChallenge: pkce.challenge });
  const res = await fetch(url, { redirect: 'manual' });
  assert.equal(res.status, 302, 'the consent endpoint must redirect');
  const location = res.headers.get('location');
  const loc = new URL(location);
  assert.equal(loc.searchParams.get('state'), state, 'state must round-trip');
  const code = loc.searchParams.get('code');
  assert.ok(code, 'the redirect must carry an authorization code');
  return { code, state, verifier: pkce.verifier };
}

async function connect(f) {
  const consent = await simulateBrowserConsent(f.cfg);
  return completeConsent(f.cfg, {
    code: consent.code,
    codeVerifier: consent.verifier,
    state: consent.state,
    oauthClient: { exchangeCode },
    healthCheckFn: healthCheck,
    store: f.store,
  });
}

// Async spawn: the mock server runs in THIS process, so the event loop must
// stay free to serve the CLI child's HTTP requests. spawnSync would deadlock.
function cli(args) {
  return new Promise((resolve) => {
    const p = spawn('node', [CLI, ...args]);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (err) => resolve({ status: -1, stdout, stderr: String(err) }));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------

describe('WO-P1 credentials-free suite — wire-accurate mock', () => {

  test('AT-P1.1 — consent URL carries PKCE/state/offline; code exchange and refresh with rotation succeed', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);

    const pkce = createPkce();
    const state = createState();
    const url = new URL(buildAuthUrl(f.cfg, { state, codeChallenge: pkce.challenge }));
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(
      url.searchParams.get('scope'),
      'youtube.upload youtube.readonly yt-analytics.readonly',
      'least-privilege scope set per the implementation-time confirmation',
    );

    const consent = await simulateBrowserConsent(f.cfg);
    const tokens = await exchangeCode(f.cfg, { code: consent.code, codeVerifier: consent.verifier });
    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken, 'offline access must yield a refresh token');
    assert.ok(tokens.scope.includes('youtube.upload'));

    const refreshed = await refreshAccessToken(f.cfg, { refreshToken: tokens.refreshToken });
    assert.ok(refreshed.accessToken);
    assert.notEqual(refreshed.accessToken, tokens.accessToken);
    assert.ok(refreshed.refreshToken, 'the mock rotates; the client must store the replacement');

    console.log('[AT-P1.1] PKCE consent + code exchange + refresh with rotation all succeed on the wire-accurate mock');
  });

  test('AT-P1.1 — token hygiene: no plaintext credential in any log, store file, audit log, or export', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);

    const consent = await simulateBrowserConsent(f.cfg);
    const exchanged = await exchangeCode(f.cfg, { code: consent.code, codeVerifier: consent.verifier });
    f.store.savePending(consent.state, exchanged);
    const tokens = f.store.takePending(consent.state);

    const hc = await healthCheck(f.cfg, tokens);
    assert.equal(hc.ok, true);
    const record = f.store.upsertConnection({
      channelId: hc.channel.id,
      channel: { id: hc.channel.id, title: hc.channel.title },
      environment: 'production',
      scopes: PRODUCTION_SCOPES,
      tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
    });
    const exportJson = JSON.stringify(projectConnection(record));

    const secrets = [tokens.accessToken, tokens.refreshToken, f.cfg.clientSecret, consent.code, consent.verifier];
    const surfaces = [...f.secrets(), exportJson];
    const names = ['module logs', 'token store file', 'audit log', 'consent record', 'connection export'];
    surfaces.forEach((surface, i) => {
      assertNoSecrets(surface, secrets, names[i]);
    });

    // the store file is genuinely encrypted at rest
    const container = JSON.parse(f.store.raw());
    assert.equal(container.alg, 'aes-256-gcm');
    assert.ok(container.ct.length > 0);
    console.log('[AT-P1.1] token hygiene: 5 secret values absent from all 5 output surfaces; store encrypted (aes-256-gcm)');
  });

  test('AT-P1.2 — health check returns channel metadata; connection stored with environment=production and the verified channel ID', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);

    const result = await connect(f);
    assert.equal(result.healthCheck.ok, true);
    assert.equal(result.healthCheck.channel.id, CHANNEL_ID);
    assert.equal(result.healthCheck.channel.title, CHANNEL_TITLE);

    const stored = f.store.getConnection(CHANNEL_ID);
    assert.ok(stored, 'the connection must be persisted');
    assert.equal(stored.environment, 'production');
    assert.equal(stored.channel.id, CHANNEL_ID);
    assert.deepEqual(stored.scopes, PRODUCTION_SCOPES);

    const listed = f.store.listConnections();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].environment, 'production');
    console.log(`[AT-P1.2] health check verified channel ${CHANNEL_ID} ("${CHANNEL_TITLE}"); stored environment=production`);
  });

  test('AT-P1.3 — re-authorizing the same channel updates the record; the connection count does not increase', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);

    const first = await connect(f);
    assert.equal(first.reauthorization, false);
    const connectedAt = first.record.connectedAt;

    const second = await connect(f);
    assert.equal(second.reauthorization, true, 'second consent must be recognized as re-authorization');
    assert.equal(f.store.listConnections().length, 1, 'connection count must not increase');

    const stored = f.store.getConnection(CHANNEL_ID);
    assert.equal(stored.connectedAt, connectedAt, 'the original connectedAt is preserved');
    assert.ok(new Date(stored.updatedAt) >= new Date(connectedAt), 'updatedAt advances');
    console.log('[AT-P1.3] re-authorization is idempotent: 1 connection, connectedAt preserved, updatedAt advanced');
  });

  test('AT-P1.4 — a write-scope operation without permission-broker approval is refused with zero side effects', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);
    await connect(f);

    const storeBefore = f.store.raw();

    const denied = await performUpload(f.cfg, {
      store: f.store,
      channelId: CHANNEL_ID,
      videoMeta: { title: 'WO-P1 gate test' },
      workOrderId: 'WO-P2',
      approvalsPath: join(f.root, 'approvals.json'), // does not exist -> no approval
    });
    assert.equal(denied.refused, true);
    assert.match(denied.reason, /No permission-broker approval/);
    assert.equal(f.mock.stats.writeCallCount(), 0, 'the denial must not reach the API');
    assert.equal(f.store.raw(), storeBefore, 'the denial must not mutate the store');

    // positive control: with broker approval the same operation proceeds
    writeFileSync(join(f.root, 'approvals.json'), JSON.stringify([{
      workOrderId: 'WO-P2',
      scopes: ['youtube.upload'],
      approved: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }]), 'utf8');
    const allowed = await performUpload(f.cfg, {
      store: f.store,
      channelId: CHANNEL_ID,
      videoMeta: { title: 'WO-P1 gate test (approved)' },
      workOrderId: 'WO-P2',
      approvalsPath: join(f.root, 'approvals.json'),
    });
    assert.equal(allowed.refused, false);
    assert.equal(allowed.ok, true);
    assert.equal(f.mock.stats.writeCallCount(), 1);
    console.log('[AT-P1.4] broker denial: refused, 0 API write calls, store byte-identical; approval path proceeds (positive control)');
  });

  test('AT-P1.5 — revoking access at the provider fails the health check loudly and marks the connection degraded', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);
    await connect(f);

    // the provider-side state after the account revokes app access
    f.mock.revokeAll();

    const r = await runHealthCheckForConnection(f.cfg, { store: f.store, channelId: CHANNEL_ID });
    assert.equal(r.ok, false, 'the health check must fail');
    assert.equal(r.degraded, true);
    assert.ok(r.reason);
    console.log(`[AT-P1.5] after provider-side revocation: health check fails loudly (reason=${r.reason})`);

    const stored = f.store.getConnection(CHANNEL_ID);
    assert.equal(stored.degraded, true, 'degraded marking must be persisted');
    assert.ok(stored.degradedReason);

    // a degraded connection also blocks write-scope use — loud, not silent
    writeFileSync(join(f.root, 'approvals.json'), JSON.stringify([{
      workOrderId: 'WO-P2',
      scopes: ['youtube.upload'],
      approved: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }]), 'utf8');
    const blocked = await performUpload(f.cfg, {
      store: f.store,
      channelId: CHANNEL_ID,
      videoMeta: { title: 'should not upload' },
      workOrderId: 'WO-P2',
      approvalsPath: join(f.root, 'approvals.json'),
    });
    assert.equal(blocked.refused, true);
    assert.match(blocked.reason, /degraded/);
    assert.equal(f.mock.stats.writeCallCount(), 0);
    console.log('[AT-P1.5] degraded connection persisted and blocks write-scope use; 0 write calls');
  });

  test('token store — protection at rest is mandatory: no key refused, wrong key fails loudly, plaintext absent', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);

    assert.throws(
      () => new TokenStore({ path: join(f.root, 'x.json'), key: null }),
      /refuses to operate without a key/,
    );

    const consent = await simulateBrowserConsent(f.cfg);
    const exchanged = await exchangeCode(f.cfg, { code: consent.code, codeVerifier: consent.verifier });
    f.store.savePending('state-x', exchanged);

    const wrongKeyStore = new TokenStore({ path: join(f.root, 'store.json'), key: generateKey() });
    assert.throws(() => wrongKeyStore.getPending('state-x'), /could not be decrypted/);

    assert.ok(!f.store.raw().includes(exchanged.accessToken), 'no plaintext access token in the store file');
    assert.ok(!f.store.raw().includes(exchanged.refreshToken), 'no plaintext refresh token in the store file');
    console.log('[token-store] key required; wrong key rejected; store file carries ciphertext only');
  });

  test('redaction utilities — nested credential keys and Authorization headers are scrubbed', () => {
    const deep = redactDeep({
      headers: { Authorization: 'Bearer ya29.a0ARrdaM...', 'X-Other': 'fine' },
      nested: { access_token: 'secret-value', refresh_token: 'secret-value', keep: 'visible' },
      list: [{ client_secret: 's' }, 'plain string'],
    });
    assert.equal(deep.headers.Authorization, '[REDACTED]');
    assert.equal(deep.headers['X-Other'], 'fine');
    assert.equal(deep.nested.access_token, '[REDACTED]');
    assert.equal(deep.nested.refresh_token, '[REDACTED]');
    assert.equal(deep.nested.keep, 'visible');
    assert.equal(deep.list[0].client_secret, '[REDACTED]');

    assert.throws(
      () => assertNoSecrets('contains leak-tok-123', ['leak-tok-123'], 'unit-test'),
      /TOKEN HYGIENE FAILURE/,
    );
    assertNoSecrets('clean text', ['leak-tok-123'], 'unit-test');
  });

  test('CLI end-to-end — consent-url, complete, healthcheck, status, export (the TL manual-run path, mock endpoints)', async (t) => {
    const f = await makeFixture();
    t.after(f.cleanup);

    const configFile = join(f.root, 'config.json');
    writeFileSync(configFile, JSON.stringify({
      ...f.mock.endpoints,
      clientId: f.mock.clientId,
      clientSecret: f.mock.clientSecret,
      redirectUri: `${f.mock.base}/oauth/callback`,
    }, null, 2), 'utf8');
    const storePath = join(f.root, 'cli-store.json');
    const common = ['--config', configFile, '--store', storePath, '--keyfile', f.keyfilePath];

    // 1. consent-url prints the production-shaped URL and parks the verifier
    const cu = await cli(['consent-url', ...common]);
    assert.equal(cu.status, 0, `consent-url failed: ${cu.stderr}`);
    const urlMatch = cu.stdout.match(/^(https?:\/\/\S+)$/m);
    assert.ok(urlMatch, 'stdout must contain the consent URL');
    const stateMatch = cu.stdout.match(/^state: (\S+)$/m);
    assert.ok(stateMatch);
    assert.ok(urlMatch[1].includes('code_challenge_method=S256'));
    assert.ok(urlMatch[1].includes('access_type=offline'));

    // 2. the browser leg (simulated) yields the code for THAT state
    const browser = await fetch(urlMatch[1], { redirect: 'manual' });
    const loc = new URL(browser.headers.get('location'));
    assert.equal(loc.searchParams.get('state'), stateMatch[1]);
    const code = loc.searchParams.get('code');
    assert.ok(code);

    // 3. complete: exchange + health check + idempotent upsert
    const done = await cli(['complete', '--code', code, '--state', stateMatch[1], ...common]);
    assert.equal(done.status, 0, `complete failed: ${done.stderr}`);
    assert.ok(done.stdout.includes(CHANNEL_ID));
    assert.ok(done.stdout.includes('environment: production'));

    // 4. healthcheck passes loudly
    const hc = await cli(['healthcheck', CHANNEL_ID, ...common]);
    assert.equal(hc.status, 0);
    assert.ok(hc.stdout.includes('HEALTH CHECK PASS'));

    // 5. status and export are redacted
    const st = await cli(['status', ...common]);
    assert.equal(st.status, 0);
    assert.ok(st.stdout.includes(CHANNEL_ID));
    const ex = await cli(['export', ...common]);
    assert.equal(ex.status, 0);
    const exported = JSON.parse(ex.stdout);
    assert.equal(exported.connections.length, 1);
    assert.equal(exported.connections[0].environment, 'production');
    assert.ok(Array.isArray(exported.auditLog) && exported.auditLog.length > 0);

    // no credential material anywhere in CLI output
    const secrets = [f.mock.clientSecret, code, stateMatch[1]];
    for (const [name, surface] of [['status', st.stdout], ['export', ex.stdout], ['complete', done.stdout]]) {
      assertNoSecrets(surface, secrets, `CLI ${name} output`);
    }
    assert.ok(!ex.stdout.includes('accessToken') && !ex.stdout.includes('refreshToken'),
      'export must not even name token fields');
    console.log('[CLI] manual-run path verified end-to-end on mock endpoints; all outputs redacted');
  });
});
