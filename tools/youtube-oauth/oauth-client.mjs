// oauth-client.mjs — Google OAuth 2.0 client for WO-P1 (production YouTube connection).
//
// Wire shapes follow Google's documented OAuth 2.0 / YouTube Data API v3
// endpoints: authorization-code flow with PKCE (S256), offline access, and
// refresh-token rotation handling. Zero dependencies (Node >= 18 global fetch).
//
// SECURITY: nothing in this module ever logs tokens. Errors carry endpoint
// status and error codes only.

import { createHash, randomBytes } from 'node:crypto';

/** @returns {string} base64url without padding */
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE pair per RFC 7636 (method S256). */
export function createPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Opaque anti-CSRF state token. */
export function createState() {
  return b64url(randomBytes(16));
}

/**
 * Build the production consent URL.
 * @param {object} cfg - from loadConfig(); requires clientId, redirectUri
 * @param {{state: string, codeChallenge: string, scopes?: string[]}} pkce
 */
export function buildAuthUrl(cfg, { state, codeChallenge, scopes = cfg.scopes }) {
  const url = new URL(cfg.authEndpoint);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Exchange the authorization code for tokens.
 * @returns {Promise<{accessToken: string, refreshToken: string|null, expiresIn: number, scope: string, tokenType: string}>}
 * @throws {Error} with endpoint status and error code (never token material)
 */
export async function exchangeCode(cfg, { code, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
  });
  return tokenRequest(cfg, body, 'code exchange');
}

/**
 * Refresh an access token. If the endpoint returns a new refresh_token
 * (rotation), the caller must replace the stored one.
 * @returns {Promise<{accessToken: string, refreshToken: string|null, expiresIn: number, scope: string, tokenType: string}>}
 */
export async function refreshAccessToken(cfg, { refreshToken }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  return tokenRequest(cfg, body, 'token refresh');
}

/** Revoke a token at the provider (Google revocation endpoint). */
export async function revokeToken(cfg, { token }) {
  const body = new URLSearchParams({ token });
  const res = await fetch(cfg.revokeEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  // Google returns 200 with an empty body on success; 400 when already invalid.
  if (!res.ok && res.status !== 400) {
    throw new Error(`revoke endpoint returned ${res.status}`);
  }
  return { ok: res.ok, status: res.status };
}

async function tokenRequest(cfg, body, phase) {
  const res = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fall through with raw status only
  }
  if (!res.ok) {
    const errCode = parsed?.error ?? `http_${res.status}`;
    const desc = parsed?.error_description ? `: ${parsed.error_description}` : '';
    throw new Error(`OAuth ${phase} failed (${errCode})${desc}`);
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null, // present on first consent or rotation
    expiresIn: parsed.expires_in,
    scope: parsed.scope ?? '',
    tokenType: parsed.token_type ?? 'Bearer',
  };
}
