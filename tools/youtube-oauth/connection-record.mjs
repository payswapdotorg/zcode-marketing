// connection-record.mjs — production connection records for WO-P1.
//
// A connection record is the durable proof of gate P1: the verified channel
// identity behind a user-authorized production connection. Records carry
// environment=production, are keyed by the real channel ID, and re-authorization
// is idempotent (WO-P1 scope item 4).

/**
 * Normalize an incoming connection payload into a record.
 * @param {object} incoming - {channelId, channel:{id,title}, scopes, tokens, environment?}
 * @param {object|null} existing - the previous record for this channelId, if any
 * @returns {object} the record to upsert (connectedAt preserved on re-auth)
 */
export function normalizeConnectionRecord(incoming, existing = null) {
  if (!incoming?.channelId) throw new Error('A connection record requires channelId.');
  if (incoming.channelId !== incoming.channel?.id) {
    throw new Error(`Channel id mismatch: record key ${incoming.channelId} vs health-check identity ${incoming.channel?.id}`);
  }
  const now = new Date().toISOString();
  return {
    channelId: incoming.channelId,
    channel: { id: incoming.channel.id, title: incoming.channel.title ?? null },
    environment: incoming.environment ?? 'production',
    scopes: incoming.scopes ?? [],
    tokens: incoming.tokens ?? null,
    connectedAt: existing?.connectedAt ?? now,
    updatedAt: now,
    degraded: false,
    degradedReason: null,
  };
}

/**
 * Complete-consent flow: exchange the code, run the pre-save health check,
 * and upsert the connection record. Returns the health-check result and the
 * persisted record. Fails loudly (throws) if the health check fails, in which
 * case NO connection record is written.
 *
 * @param {object} cfg - loadConfig() output with mock or production endpoints
 * @param {object} deps - {oauthClient, healthCheck, store}
 */
export async function completeConsent(cfg, { code, codeVerifier, state, oauthClient, healthCheckFn, store }) {
  const exchanged = await oauthClient.exchangeCode(cfg, { code, codeVerifier });
  store.savePending(state, exchanged);
  const tokens = store.takePending(state);

  const hc = await healthCheckFn(cfg, tokens);
  if (!hc.ok) {
    throw new Error(
      `Pre-save health check FAILED (${hc.reason}): ${hc.error ?? 'no detail'}. `
      + 'No connection record was written; the authorization was not saved.',
    );
  }

  const existing = store.getConnectionWithTokens(hc.channel.id);
  const record = normalizeConnectionRecord(
    {
      channelId: hc.channel.id,
      channel: { id: hc.channel.id, title: hc.channel.title },
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? existing?.tokens?.refreshToken ?? null,
        expiresAt: new Date(Date.now() + (tokens.expiresIn ?? 3599) * 1000).toISOString(),
      },
      environment: 'production',
    },
    existing,
  );
  const persisted = store.upsertConnection(record);
  return { healthCheck: hc, record: persisted, reauthorization: Boolean(existing) };
}
