#!/usr/bin/env node
// cli.mjs — manual-run CLI for WO-P1 (production YouTube connection).
//
// The credentialed consent flow is a RECORDED MANUAL RUN by the TL (handoff
// Section 8: credentialed acceptance runs happen outside credentials-free CI;
// CI never receives secrets). This CLI is the tool for that run; the same
// code paths are exercised credentials-free by the test suite against the
// wire-accurate mock server.
//
// Exit codes: 0 pass · 1 health failure / degraded · 2 usage or config error ·
// 3 broker refusal (no side effects).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, validateForConsent } from './config.mjs';
import { createPkce, createState, buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken } from './oauth-client.mjs';
import { TokenStore, generateKey } from './token-store.mjs';
import { completeConsent } from './connection-record.mjs';
import { healthCheck, runHealthCheckForConnection } from './health-check.mjs';
import { performUpload } from './broker-gate.mjs';
import { projectConnection } from './redact.mjs';

const USAGE = `youtube-oauth — WO-P1 production YouTube connection (manual-run CLI)

Usage:
  youtube-oauth genkey
  youtube-oauth consent-url  [--config FILE] [--store PATH] [--keyfile PATH]
                             [--redirect-uri URI]
  youtube-oauth complete --code CODE --state STATE
                             [--config FILE] [--store PATH] [--keyfile PATH]
  youtube-oauth healthcheck CHANNEL_ID   [--config FILE] [--store PATH] [--keyfile PATH]
  youtube-oauth refresh CHANNEL_ID       [--config FILE] [--store PATH] [--keyfile PATH]
  youtube-oauth revoke CHANNEL_ID        [--config FILE] [--store PATH] [--keyfile PATH]
  youtube-oauth status                   [--store PATH] [--keyfile PATH]
  youtube-oauth export                   [--store PATH] [--keyfile PATH]
  youtube-oauth upload --channel ID --meta FILE.json --work-order WO-P2
                             --approvals PATH [--config FILE] [--store PATH] [--keyfile PATH]

Environment: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI,
YOUTUBE_TOKEN_STORE, YOUTUBE_TOKEN_STORE_KEYFILE (also settable via --config FILE).

Every stored artifact is redacted; token material never appears in output.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const valueFlags = new Set(['config', 'store', 'keyfile', 'code', 'state', 'channel', 'meta', 'work-order', 'approvals', 'redirect-uri']);
      if (valueFlags.has(key)) {
        if (i + 1 >= argv.length) throw new Error(`Flag --${key} requires a value.`);
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function buildStore(flags) {
  const storePath = flags.store ?? process.env.YOUTUBE_TOKEN_STORE ?? join(process.cwd(), '.youtube-oauth', 'store.json');
  const keyfilePath = flags.keyfile ?? process.env.YOUTUBE_TOKEN_STORE_KEYFILE;
  let key = null;
  if (keyfilePath) {
    key = readFileSync(keyfilePath, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      process.stderr.write(`Keyfile ${keyfilePath} must contain exactly 64 hex chars (generate with genkey).\n`);
      process.exit(2);
    }
  } else if (process.env.YOUTUBE_TOKEN_STORE_KEY) {
    key = process.env.YOUTUBE_TOKEN_STORE_KEY;
  }
  try {
    return new TokenStore({ path: storePath, key, auditPath: `${storePath}.audit-log.jsonl` });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}

function buildConfig(flags) {
  let file;
  if (flags.config) file = readFileSync(flags.config, 'utf8');
  const cfg = loadConfig({ file });
  if (flags['redirect-uri']) cfg.redirectUri = flags['redirect-uri'];
  return cfg;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    return 2;
  }
  const { positional, flags } = parsed;
  const command = positional[0];

  switch (command) {
    case 'genkey': {
      const key = generateKey();
      process.stdout.write(
        `${key}\n\nStore this in a keyfile readable only by the operator (e.g. chmod 600),\n`
        + 'then pass --keyfile PATH or set YOUTUBE_TOKEN_STORE_KEYFILE.\n'
        + 'The key is NOT a credential by itself; losing it makes the store unrecoverable.\n',
      );
      return 0;
    }

    case 'consent-url': {
      let cfg;
      try {
        cfg = validateForConsent(buildConfig(flags));
      } catch (err) {
        process.stderr.write(`${err.message}\n`);
        return 2;
      }
      const store = buildStore(flags);
      const pkce = createPkce();
      const state = createState();
      store.savePending(state, { codeVerifier: pkce.verifier });
      const url = buildAuthUrl(cfg, { state, codeChallenge: pkce.challenge });
      process.stdout.write(
        `Open this URL in a browser, complete consent as the account that owns the channel:\n\n${url}\n\n`
        + `state: ${state}\n`
        + `After consent Google redirects to: ${cfg.redirectUri}?code=...&state=${state}\n`
        + 'Then run: youtube-oauth complete --code <code> --state <state>\n',
      );
      return 0;
    }

    case 'complete': {
      if (!flags.code || !flags.state) {
        process.stderr.write('complete requires --code CODE and --state STATE.\n');
        return 2;
      }
      let cfg;
      try {
        cfg = validateForConsent(buildConfig(flags));
      } catch (err) {
        process.stderr.write(`${err.message}\n`);
        return 2;
      }
      const store = buildStore(flags);
      const pending = store.getPending(flags.state);
      const verifier = pending?.tokens?.codeVerifier;
      if (!verifier) {
        process.stderr.write(`No pending consent for state ${flags.state}; run consent-url first.\n`);
        return 2;
      }
      return (async () => {
        try {
          const result = await completeConsent(cfg, {
            code: flags.code,
            codeVerifier: verifier,
            state: flags.state,
            oauthClient: { exchangeCode },
            healthCheckFn: healthCheck,
            store,
          });
          const p = projectConnection(result.record);
          process.stdout.write(
            `Pre-save health check PASSED — verified production channel:\n`
            + `  channelId: ${p.channelId}\n  title:     ${p.channelTitle}\n`
            + `  environment: ${p.environment}\n  scopes: ${p.scopes.join(', ')}\n`
            + `  ${result.reauthorization ? 'UPDATED existing connection (idempotent re-authorization)' : 'NEW connection stored'}\n`,
          );
          return 0;
        } catch (err) {
          process.stderr.write(`COMPLETE FAILED — no connection record written.\n${err.message}\n`);
          return 1;
        }
      })();
    }

    case 'healthcheck': {
      const channelId = positional[1];
      if (!channelId) {
        process.stderr.write('healthcheck requires CHANNEL_ID (see status).\n');
        return 2;
      }
      const cfg = buildConfig(flags);
      const store = buildStore(flags);
      return (async () => {
        try {
          const r = await runHealthCheckForConnection(cfg, { store, channelId });
          if (r.ok) {
            process.stdout.write(`HEALTH CHECK PASS — ${channelId}: ${r.channel.title} (production)\n`);
            return 0;
          }
          process.stderr.write(`HEALTH CHECK FAIL — connection marked DEGRADED.\n  reason: ${r.reason}\n  ${r.error ?? ''}\n`);
          return 1;
        } catch (err) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
      })();
    }

    case 'refresh': {
      const channelId = positional[1];
      if (!channelId) {
        process.stderr.write('refresh requires CHANNEL_ID.\n');
        return 2;
      }
      const cfg = buildConfig(flags);
      const store = buildStore(flags);
      return (async () => {
        const conn = store.getConnectionWithTokens(channelId);
        if (!conn) {
          process.stderr.write(`No connection for ${channelId}.\n`);
          return 2;
        }
        try {
          const t = await refreshAccessToken(cfg, { refreshToken: conn.tokens.refreshToken });
          store.updateTokens(channelId, {
            accessToken: t.accessToken,
            refreshToken: t.refreshToken ?? conn.tokens.refreshToken,
            expiresAt: new Date(Date.now() + t.expiresIn * 1000).toISOString(),
          });
          process.stdout.write(
            `Token refreshed for ${channelId}${t.refreshToken ? ' (refresh token ROTATED and replaced)' : ''}.\n`,
          );
          return 0;
        } catch (err) {
          store.markDegraded(channelId, `refresh-failed: ${err.message}`.slice(0, 300));
          process.stderr.write(`REFRESH FAILED — connection marked DEGRADED.\n${err.message}\n`);
          return 1;
        }
      })();
    }

    case 'revoke': {
      const channelId = positional[1];
      if (!channelId) {
        process.stderr.write('revoke requires CHANNEL_ID.\n');
        return 2;
      }
      const cfg = buildConfig(flags);
      const store = buildStore(flags);
      return (async () => {
        const conn = store.getConnectionWithTokens(channelId);
        if (!conn) {
          process.stderr.write(`No connection for ${channelId}.\n`);
          return 2;
        }
        const r = await revokeToken(cfg, { token: conn.tokens.refreshToken });
        store.markDegraded(channelId, `revoked-at-provider (revoke status ${r.status})`);
        process.stdout.write(`Revocation sent (status ${r.status}); connection marked degraded. Next health check fails loudly.\n`);
        return 0;
      })();
    }

    case 'status': {
      const store = buildStore(flags);
      const conns = store.listConnections();
      if (conns.length === 0) {
        process.stdout.write('No connections stored.\n');
        return 0;
      }
      for (const c of conns) {
        process.stdout.write(
          `${c.channelId}  "${c.channelTitle}"  environment=${c.environment}  degraded=${c.degraded}\n`
          + `  connected ${c.connectedAt} · updated ${c.updatedAt}\n`,
        );
      }
      return 0;
    }

    case 'export': {
      const store = buildStore(flags);
      const out = {
        exportedAt: new Date().toISOString(),
        connections: store.listConnections().map(projectConnection),
        auditLog: store.auditLog().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
      };
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return 0;
    }

    case 'upload': {
      if (!flags.channel || !flags.meta || !flags['work-order'] || !flags.approvals) {
        process.stderr.write('upload requires --channel ID --meta FILE.json --work-order ID --approvals PATH.\n');
        return 2;
      }
      let meta;
      try {
        meta = JSON.parse(readFileSync(flags.meta, 'utf8'));
      } catch (err) {
        process.stderr.write(`Cannot read meta file: ${err.message}\n`);
        return 2;
      }
      const cfg = buildConfig(flags);
      const store = buildStore(flags);
      return (async () => {
        const r = await performUpload(cfg, {
          store,
          channelId: flags.channel,
          videoMeta: meta,
          workOrderId: flags['work-order'],
          approvalsPath: flags.approvals,
        });
        if (r.refused) {
          process.stderr.write(`UPLOAD REFUSED (no side effects):\n${r.reason}\n`);
          return 3;
        }
        if (!r.ok) {
          process.stderr.write(`UPLOAD FAILED (HTTP ${r.status}).\n${JSON.stringify(r.error)}\n`);
          return 1;
        }
        process.stdout.write(`Uploaded: videoId=${r.videoId}\n`);
        return 0;
      })();
    }

    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}\n`);
      return 2;
  }
}

// Top-level await in ESM main:
const code = await Promise.resolve(main());
process.exit(code);
