// mock-google.mjs — wire-accurate mock of the Google endpoints WO-P1 touches.
//
// Used ONLY by the credentials-free test suite and local dry runs. Response
// bodies, status codes, and error shapes mirror the documented Google OAuth
// 2.0 and YouTube Data API v3 wire formats so the tested code path equals the
// production code path. It never contains real credentials.
//
// Endpoints:
//   GET  /o/oauth2/v2/auth                -> 302 redirect with code+state (or error)
//   POST /token                           -> authorization_code / refresh_token grants
//   POST /o/oauth2/revoke                 -> revocation
//   GET  /youtube/v3/channels?mine=true   -> channel identity (or 401 authError)
//   POST /upload/youtube/v3/videos        -> write-scope target (counted)

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startMockGoogle({
  clientId = 'mock-client-id-0000000000000000000000000000',
  clientSecret = 'mock-client-secret-000000000000000000000000',
  channelId = 'UCmockChannelId0000000000000000',
  channelTitle = 'Brand Test Channel (mock)',
} = {}) {
  let seq = 0;
  const consentEvents = [];
  const codes = new Map(); // code -> {challenge, scope, used}
  const accessTokens = new Map(); // accessToken -> {refreshToken, scope}
  const refreshTokens = new Map(); // refreshToken -> {scope}
  const writeCalls = [];
  const serverState = { revoked: false, rotateRefreshTokens: true };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') return handleAuth(url, res);
    if (req.method === 'POST' && url.pathname === '/token') return readBody(req, (body) => handleToken(body, res));
    if (req.method === 'POST' && url.pathname === '/o/oauth2/revoke') return readBody(req, (body) => handleRevoke(body, res));
    if (req.method === 'GET' && url.pathname === '/youtube/v3/channels') return handleChannels(req, url, res);
    if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') return handleUpload(req, res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 404, message: `mock: no route ${req.method} ${url.pathname}` } }));
  });

  function handleAuth(url, res) {
    const q = url.searchParams;
    const problems = [];
    if (q.get('client_id') !== clientId) problems.push('client_id mismatch');
    if (q.get('response_type') !== 'code') problems.push('response_type must be code');
    if (!q.get('redirect_uri')) problems.push('redirect_uri missing');
    if (q.get('code_challenge_method') !== 'S256') problems.push('code_challenge_method must be S256');
    if (!q.get('code_challenge')) problems.push('code_challenge missing');
    if (!q.get('state')) problems.push('state missing');
    if (q.get('access_type') !== 'offline') problems.push('access_type must be offline for refresh tokens');
    consentEvents.push({ at: new Date().toISOString(), ok: problems.length === 0, problems });
    if (problems.length > 0) {
      const redirect = new URL(q.get('redirect_uri') ?? 'http://127.0.0.1/unused');
      redirect.searchParams.set('error', 'invalid_request');
      redirect.searchParams.set('error_description', `mock auth: ${problems.join('; ')}`);
      res.writeHead(302, { Location: redirect.toString() });
      return res.end();
    }
    const code = `mock-auth-code-${String(++seq).padStart(3, '0')}`;
    codes.set(code, { challenge: q.get('code_challenge'), scope: q.get('scope'), used: false });
    const redirect = new URL(q.get('redirect_uri'));
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', q.get('state'));
    res.writeHead(302, { Location: redirect.toString() });
    res.end();
  }

  function handleToken(body, res) {
    const p = new URLSearchParams(body);
    const grant = p.get('grant_type');
    if (p.get('client_id') !== clientId || p.get('client_secret') !== clientSecret) {
      return json(res, 400, { error: 'invalid_client', error_description: 'mock: bad client credentials' });
    }
    if (grant === 'authorization_code') {
      const code = p.get('code');
      const entry = codes.get(code);
      if (!entry || entry.used) return json(res, 400, { error: 'invalid_grant', error_description: 'mock: unknown or reused code' });
      const verifier = p.get('code_verifier') ?? '';
      const expected = b64url(createHash('sha256').update(verifier).digest());
      if (expected !== entry.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'mock: PKCE verification failed' });
      entry.used = true;
      const accessToken = `mock-access-token-${b64url(String(Math.random()).slice(2))}-${++seq}`;
      const refreshToken = `mock-refresh-token-${b64url(String(Math.random()).slice(2))}-${++seq}`;
      accessTokens.set(accessToken, { refreshToken, scope: entry.scope });
      refreshTokens.set(refreshToken, { scope: entry.scope });
      return json(res, 200, {
        access_token: accessToken,
        expires_in: 3599,
        refresh_token: refreshToken,
        scope: entry.scope,
        token_type: 'Bearer',
      });
    }
    if (grant === 'refresh_token') {
      const rt = p.get('refresh_token');
      if (!refreshTokens.has(rt) || serverState.revoked) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'mock: refresh token invalid or revoked' });
      }
      const scope = refreshTokens.get(rt).scope;
      const accessToken = `mock-access-token-${b64url(String(Math.random()).slice(2))}-${++seq}`;
      let outRefreshToken = null;
      if (serverState.rotateRefreshTokens) {
        refreshTokens.delete(rt);
        outRefreshToken = `mock-refresh-token-${b64url(String(Math.random()).slice(2))}-${++seq}`;
        refreshTokens.set(outRefreshToken, { scope });
      }
      accessTokens.set(accessToken, { refreshToken: outRefreshToken ?? rt, scope });
      const payload = { access_token: accessToken, expires_in: 3599, scope, token_type: 'Bearer' };
      if (outRefreshToken) payload.refresh_token = outRefreshToken;
      return json(res, 200, payload);
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }

  function handleRevoke(body, res) {
    const p = new URLSearchParams(body);
    const token = p.get('token') ?? '';
    let found = refreshTokens.delete(token);
    if (accessTokens.delete(token)) found = true;
    // Also invalidate every access token belonging to a revoked refresh token.
    for (const [at, meta] of accessTokens) {
      if (meta.refreshToken === token) accessTokens.delete(at);
    }
    if (found) serverState.revoked = true;
    // Google returns 200 {} on success, 400 for unknown tokens.
    return json(res, found ? 200 : 400, found ? {} : { error: 'invalid_grant' });
  }

  function handleChannels(req, url, res) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const meta = token ? accessTokens.get(token) : null;
    if (!meta) {
      return json(res, 401, {
        error: {
          code: 401,
          message: "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.",
          errors: [{
            message: 'Request had invalid authentication credentials.',
            domain: 'global',
            reason: 'authError',
            location: 'Authorization',
            locationType: 'header',
          }],
          status: 'UNAUTHENTICATED',
        },
      });
    }
    return json(res, 200, {
      kind: 'youtube#channelListResponse',
      etag: 'mock-etag',
      pageInfo: { totalResults: 1, resultsPerPage: 1 },
      items: [{
        kind: 'youtube#channel',
        etag: 'mock-etag-item',
        id: channelId,
        snippet: {
          title: channelTitle,
          description: 'Mock channel for credentials-free WO-P1 testing.',
          publishedAt: '2020-01-01T00:00:00Z',
          thumbnails: { default: { url: `https://mock.invalid/${channelId}/default.jpg` } },
          localized: { title: channelTitle },
        },
        contentDetails: { relatedPlaylists: { uploads: `UU${channelId.slice(2)}` } },
      }],
    });
  }

  function handleUpload(req, res) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !accessTokens.has(token)) {
      return json(res, 401, { error: { code: 401, message: 'mock: unauthorized upload', errors: [{ reason: 'authError' }] } });
    }
    readBody(req, (body) => {
      writeCalls.push({ at: new Date().toISOString(), bodyPreview: String(body).slice(0, 200) });
      json(res, 200, { kind: 'youtube#video', id: `mock-video-${String(writeCalls.length).padStart(4, '0')}`, etag: 'mock-etag' });
    });
  }

  function readBody(req, cb) {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => cb(data));
  }

  function json(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    clientId,
    clientSecret,
    /** Configuration pointing every endpoint at this mock. */
    endpoints: {
      authEndpoint: `${base}/o/oauth2/v2/auth`,
      tokenEndpoint: `${base}/token`,
      revokeEndpoint: `${base}/o/oauth2/revoke`,
      apiBase: base,
      uploadBase: `${base}/upload`,
    },
    /** Simulate the account revoking access at the provider (AT-P1.5). */
    revokeAll() {
      serverState.revoked = true;
      accessTokens.clear();
      refreshTokens.clear();
    },
    stats: {
      consentEvents: () => [...consentEvents],
      writeCallCount: () => writeCalls.length,
      writeCalls: () => [...writeCalls],
      refreshTokens: () => [...refreshTokens.keys()],
    },
    close: () => new Promise((resolve) => {
      // Drop idle keep-alive sockets so close() cannot hang on lingering
      // undici connections from previous fetches.
      server.closeIdleConnections?.();
      server.close(() => {
        server.closeAllConnections?.();
        resolve();
      });
    }),
  };
}
