// config.mjs — configuration loading for the WO-P1 YouTube OAuth client.
//
// Defaults are the real production Google endpoints. Every endpoint is
// overridable (env vars or a JSON config file) so the credentials-free test
// suite can point the same code paths at the wire-accurate mock server — the
// manual production run and the tested code path are identical.

export const PRODUCTION_SCOPES = [
  'youtube.upload',      // WO-P2: videos.insert (publication)
  'youtube.readonly',    // health check (channels.list mine) + WO-P2 read-back (videos.list)
  'yt-analytics.readonly', // WO-P3: YouTube Analytics reports.query
];

export const DEFAULTS = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com',
  uploadBase: 'https://www.googleapis.com/upload',
  scopes: PRODUCTION_SCOPES,
};

const ENV_MAP = {
  GOOGLE_CLIENT_ID: 'clientId',
  GOOGLE_CLIENT_SECRET: 'clientSecret',
  OAUTH_REDIRECT_URI: 'redirectUri',
  YOUTUBE_AUTH_ENDPOINT: 'authEndpoint',
  YOUTUBE_TOKEN_ENDPOINT: 'tokenEndpoint',
  YOUTUBE_REVOKE_ENDPOINT: 'revokeEndpoint',
  YOUTUBE_API_BASE: 'apiBase',
  YOUTUBE_UPLOAD_BASE: 'uploadBase',
  YOUTUBE_TOKEN_STORE: 'storePath',
  YOUTUBE_TOKEN_STORE_KEYFILE: 'keyfilePath',
};

/**
 * Load config: DEFAULTS <- optional JSON file <- environment.
 * The mock/test endpoints win by being passed in `overrides`.
 */
export function loadConfig({ env = process.env, file } = {}) {
  const cfg = { ...DEFAULTS, scopes: [...DEFAULTS.scopes] };
  if (file) {
    const parsed = JSON.parse(file);
    Object.assign(cfg, parsed);
  }
  for (const [envKey, cfgKey] of Object.entries(ENV_MAP)) {
    if (env[envKey] !== undefined && env[envKey] !== '') cfg[cfgKey] = env[envKey];
  }
  return cfg;
}

/** Throw a loud, actionable error when required fields are missing. */
export function validateForConsent(cfg) {
  const missing = ['clientId', 'clientSecret', 'redirectUri'].filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(
      `Configuration incomplete for the consent flow: missing ${missing.join(', ')}. `
      + 'Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / OAUTH_REDIRECT_URI or pass --config.',
    );
  }
  return cfg;
}
