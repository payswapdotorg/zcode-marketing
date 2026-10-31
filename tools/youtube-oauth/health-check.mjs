// health-check.mjs — pre-save account health check for WO-P1 (scope item 3)
// and degraded-state handling (scope item 6).
//
// The health check calls the production endpoint channels.list?mine=true with
// the connection's access token, refreshes once on 401, and returns the real
// channel identity. A revoked/expired authorization degrades the connection
// and fails loudly on next use.

import { refreshAccessToken } from './oauth-client.mjs';

/**
 * @param {object} cfg - loadConfig() output
 * @param {{accessToken: string, refreshToken?: string|null}} tokens
 * @returns {Promise<{ok: true, channel: {id, title, publishedAt}, refreshed: object|null}
 *          |{ok: false, degraded: true, reason: string, error?: string}>}
 */
export async function healthCheck(cfg, tokens) {
  let current = tokens.accessToken;
  let refreshed = null;

  let res = await channelsList(cfg, current);
  if (res.status === 401 && tokens.refreshToken) {
    try {
      refreshed = await refreshAccessToken(cfg, { refreshToken: tokens.refreshToken });
      current = refreshed.accessToken;
      res = await channelsList(cfg, current);
    } catch (err) {
      return { ok: false, degraded: true, reason: 'refresh-failed', error: err.message };
    }
  }
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, degraded: true, reason: `channels-list-http-${res.status}`, error: body.slice(0, 500) };
  }
  const body = await res.json();
  const item = body?.items?.[0];
  if (!item?.id) {
    return { ok: false, degraded: true, reason: 'no-channel-on-account', error: 'channels.list returned no items.' };
  }
  return {
    ok: true,
    channel: {
      id: item.id,
      title: item.snippet?.title ?? null,
      publishedAt: item.snippet?.publishedAt ?? null,
    },
    refreshed,
  };
}

function channelsList(cfg, accessToken) {
  return fetch(`${cfg.apiBase}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Run the health check for a stored connection and persist the outcome:
 * refreshed tokens on success, degraded marking on failure (loud).
 * @returns {Promise<{ok: boolean, degraded: boolean, reason?: string, channel?: object}>}
 */
export async function runHealthCheckForConnection(cfg, { store, channelId }) {
  const conn = store.getConnectionWithTokens(channelId);
  if (!conn) throw new Error(`No connection for channel ${channelId}.`);
  const hc = await healthCheck(cfg, conn.tokens ?? {});
  if (!hc.ok) {
    store.markDegraded(channelId, `${hc.reason}: ${hc.error ?? ''}`.slice(0, 300));
    return { ok: false, degraded: true, reason: hc.reason, error: hc.error };
  }
  if (hc.refreshed) {
    store.updateTokens(channelId, {
      accessToken: hc.refreshed.accessToken,
      refreshToken: hc.refreshed.refreshToken ?? conn.tokens.refreshToken,
      expiresAt: new Date(Date.now() + (hc.refreshed.expiresIn ?? 3599) * 1000).toISOString(),
    });
  }
  if (conn.degraded) store.markHealthy(channelId);
  return { ok: true, degraded: false, channel: hc.channel };
}
