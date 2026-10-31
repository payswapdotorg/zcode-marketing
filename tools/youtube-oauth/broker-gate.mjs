// broker-gate.mjs + publish-flow.mjs equivalents for WO-P1.
//
// Permission-broker approval gate (WO-P1 scope item 5): any write-scope
// operation must carry an explicit broker approval BEFORE the API is called.
// Denial exits without side effects — no network call, no store mutation.

import { existsSync, readFileSync } from 'node:fs';

/**
 * Load broker approvals written by the permission broker.
 * Shape: [{workOrderId, scopes: string[], approved: boolean, expiresAt: ISO}]
 */
export function loadApprovals(path) {
  if (!path || !existsSync(path)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Broker approvals file ${path} is not valid JSON: ${err.message}`);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * @returns {{allowed: boolean, reason: string}} — allowed only when a live
 * approval covers the work order and every required scope.
 */
export function checkApproval({ approvals, workOrderId, requiredScopes, now = new Date() }) {
  for (const a of approvals) {
    if (a.workOrderId !== workOrderId && a.workOrderId !== '*') continue;
    if (a.approved !== true) continue;
    if (a.expiresAt && new Date(a.expiresAt) < now) continue;
    const granted = new Set(a.scopes ?? []);
    if (requiredScopes.every((s) => granted.has(s))) {
      return { allowed: true, reason: `approved by broker for ${a.workOrderId} (${requiredScopes.join(', ')})` };
    }
  }
  return {
    allowed: false,
    reason:
      `No permission-broker approval covers ${workOrderId} for scope [${requiredScopes.join(', ')}]. `
      + 'Request broker approval before any write-scope operation.',
  };
}

/**
 * The write-scope operation itself (videos.insert). The gate runs FIRST;
 * a denial returns before any fetch or store mutation (AT-P1.4).
 */
export async function performUpload(cfg, { store, channelId, videoMeta, workOrderId, approvalsPath }) {
  const gate = checkApproval({
    approvals: loadApprovals(approvalsPath),
    workOrderId,
    requiredScopes: ['youtube.upload'],
  });
  if (!gate.allowed) {
    return { refused: true, reason: gate.reason };
  }
  const conn = store.getConnectionWithTokens(channelId);
  if (!conn) {
    return { refused: true, reason: `No connection for channel ${channelId}.` };
  }
  if (conn.degraded) {
    return { refused: true, reason: `Connection for ${channelId} is degraded; run a health check first.` };
  }
  const res = await fetch(`${cfg.uploadBase}/youtube/v3/videos?part=snippet`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ snippet: videoMeta, status: { privacyStatus: 'private' } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { refused: false, ok: false, status: res.status, error: body };
  }
  return { refused: false, ok: true, videoId: body.id };
}
