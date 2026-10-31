// token-store.mjs — encrypted-at-rest token and connection store for WO-P1.
//
// - One file per workspace, AES-256-GCM encrypted; the key never lives in the
//   store, is never logged, and must come from a keyfile or env (WO-P1 scope
//   item 2: protection at rest).
// - Every mutation appends a REDACTED audit entry (action + channel id +
//   timestamp only) to the audit log — never token material.
// - The store refuses to operate without a key: plaintext-at-rest is not a
//   fallback mode.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export function generateKey() {
  return randomBytes(32).toString('hex');
}

function keyBuffer(key) {
  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) throw new Error('Token-store key must be 32 bytes.');
    return key;
  }
  const buf = Buffer.from(String(key), 'hex');
  if (buf.length !== 32) {
    throw new Error('Token-store key must be 64 hex chars (32 bytes). Generate one with: node cli.mjs genkey');
  }
  return buf;
}

export class TokenStore {
  /**
   * @param {{path: string, key: string|Buffer, auditPath?: string, logger?: {log: (s: string) => void}}} opts
   */
  constructor({ path, key, auditPath, logger }) {
    if (!path) throw new Error('TokenStore requires a store path.');
    if (!key) {
      throw new Error(
        'TokenStore refuses to operate without a key (protection at rest is mandatory). '
        + 'Generate one with `node cli.mjs genkey` and pass --keyfile or YOUTUBE_TOKEN_STORE_KEYFILE.',
      );
    }
    this.path = path;
    this.key = keyBuffer(key);
    this.auditPath = auditPath ?? `${path}.audit-log.jsonl`;
    this.logger = logger ?? { log: () => {} };
  }

  audit(action, detail = {}) {
    const entry = { ts: new Date().toISOString(), action, ...detail };
    appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
    this.logger.log(`[token-store] ${action}${detail.channelId ? ` channel=${detail.channelId}` : ''}`);
  }

  _encrypt(plain) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]);
    return {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    };
  }

  _decrypt(container) {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(container.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(container.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(container.ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  }

  _readAll() {
    if (!existsSync(this.path)) return { connections: {}, pending: {} };
    let container;
    try {
      container = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (err) {
      throw new Error(`Token store ${this.path} is not valid JSON: ${err.message}`);
    }
    if (container.alg !== 'aes-256-gcm') {
      throw new Error(`Token store ${this.path} uses unknown algorithm '${container.alg}' — refusing.`);
    }
    try {
      return this._decrypt(container);
    } catch {
      throw new Error(`Token store ${this.path} could not be decrypted with the provided key — wrong key or tampered file.`);
    }
  }

  _writeAll(data) {
    writeFileSync(this.path, JSON.stringify(this._encrypt(data), null, 2) + '\n', 'utf8');
  }

  /** Park tokens between code exchange and health check (keyed by state). */
  savePending(state, tokens) {
    const all = this._readAll();
    all.pending[state] = { tokens, createdAt: new Date().toISOString() };
    this._writeAll(all);
    this.audit('save-pending', {});
  }

  /** Read pending entry without consuming it (used by the CLI between consent-url and complete). */
  getPending(state) {
    return this._readAll().pending[state] ?? null;
  }

  takePending(state) {
    const all = this._readAll();
    const entry = all.pending[state];
    if (!entry) return null;
    delete all.pending[state];
    this._writeAll(all);
    this.audit('take-pending', {});
    return entry.tokens;
  }

  /**
   * Idempotent upsert keyed by channelId: re-authorizing the same channel
   * updates the record instead of duplicating it (AT-P1.3).
   */
  upsertConnection(record) {
    const all = this._readAll();
    const existing = all.connections[record.channelId];
    const merged = {
      ...existing,
      ...record,
      connectedAt: existing?.connectedAt ?? record.connectedAt,
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    };
    all.connections[record.channelId] = merged;
    this._writeAll(all);
    this.audit(existing ? 'connection-updated' : 'connection-created', { channelId: record.channelId });
    return merged;
  }

  getConnection(channelId) {
    return this._readAll().connections[channelId] ?? null;
  }

  /** Token material included — internal use only, never log or export. */
  getConnectionWithTokens(channelId) {
    return this._readAll().connections[channelId] ?? null;
  }

  listConnections() {
    return Object.values(this._readAll().connections).map((c) => ({
      channelId: c.channelId,
      channelTitle: c.channel?.title ?? null,
      environment: c.environment,
      degraded: c.degraded ?? false,
      connectedAt: c.connectedAt,
      updatedAt: c.updatedAt,
    }));
  }

  updateTokens(channelId, tokens) {
    const all = this._readAll();
    if (!all.connections[channelId]) throw new Error(`No connection ${channelId} to update tokens for.`);
    all.connections[channelId].tokens = tokens;
    all.connections[channelId].updatedAt = new Date().toISOString();
    this._writeAll(all);
    this.audit('tokens-refreshed', { channelId });
  }

  markDegraded(channelId, reason) {
    const all = this._readAll();
    if (!all.connections[channelId]) throw new Error(`No connection ${channelId} to mark degraded.`);
    all.connections[channelId].degraded = true;
    all.connections[channelId].degradedReason = reason;
    all.connections[channelId].updatedAt = new Date().toISOString();
    this._writeAll(all);
    this.audit('connection-degraded', { channelId, reason });
  }

  markHealthy(channelId) {
    const all = this._readAll();
    if (!all.connections[channelId]) return;
    all.connections[channelId].degraded = false;
    all.connections[channelId].degradedReason = null;
    all.connections[channelId].updatedAt = new Date().toISOString();
    this._writeAll(all);
    this.audit('connection-recovered', { channelId });
  }

  raw() {
    return existsSync(this.path) ? readFileSync(this.path, 'utf8') : '';
  }

  auditLog() {
    return existsSync(this.auditPath) ? readFileSync(this.auditPath, 'utf8') : '';
  }
}
