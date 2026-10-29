/**
 * YouTube connected-account publishing connector — the W5 publishing adapter
 * (docs/marketing/MARKETING-DATA-SOURCES.md, "YouTube publishing (connected
 * account)" row).
 *
 * Wire protocol: the REAL YouTube Data API v3 resumable-upload path —
 *   1. POST  <dataBase>/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *      (Bearer token, snippet/status metadata JSON) -> 200 + `Location` session URL
 *   2. PUT   <session URL> (video bytes) -> 201 + Video resource { id, snippet, status }
 *   3. GET   <dataBase>/youtube/v3/videos?part=status,snippet&id=<id>   (post-status verification)
 *   4. GET   <analyticsBase>/v2/reports?ids=channel==<accountRef>&metrics=views&startDate&endDate&filters=video==<id>
 *      (YouTube Analytics API daily totals — W6 permitted analytics)
 *
 * The connection record carries the endpoints + access token, so the SAME code
 * path serves the real googleapis endpoints (production OAuth) and a connected
 * test account (sandbox endpoint). The environment label travels with every
 * publication record and coverage slice — a sandbox post is never presented as
 * a production post.
 *
 * Honesty rules encoded here (PLATFORM-CONNECTOR-CONTRACT.md):
 *   - capabilities: analytics + publishing ONLY (research/scheduling/paidAds
 *     are never implied — calling research() is a typed refusal);
 *   - organic publishing NEVER authorizes paidAds (separate permission domain);
 *   - idempotency: the same idempotency key returns the same post, never a
 *     duplicate upload (in-process map + the caller's persisted records);
 *   - the token exists only inside this adapter's requests — never in errors,
 *     coverage slices, or returned records (auth hygiene, grep-enforced).
 *
 * Layer: adapters — all network I/O lives here and nowhere else.
 */
import type { MetricObservation } from '../../domain/records.js';
import type {
  AnalyticsPage,
  AnalyticsRequest,
  ConnectorMeta,
  MarketingConnector,
  PublicationVerification,
  PublishRequest,
  PublishOutcome,
  ResearchPage,
  ResearchRequest,
} from '../../app/ports.js';
import { ConnectorFailure } from '../../app/ports.js';

/** Injectable fetch so fixture tests never hit the network (conformance rule 1). */
export type PublishFetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

const defaultFetch: PublishFetchLike = async (url, init) => {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    ...(init?.headers ? { headers: init.headers } : {}),
    ...(init?.body !== undefined ? { body: init.body as string | Uint8Array<ArrayBuffer> } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: res.status, headers, body: await res.text() };
};

/** A connected publishing account — what the connection store persists. */
export interface PublishingConnection {
  connectionId: string;
  label: string;
  platform: 'youtube';
  /** Data API + upload base, e.g. https://www.googleapis.com (or a connected test account). */
  dataBase: string;
  /** Analytics API base, e.g. https://youtubeanalytics.googleapis.com. */
  analyticsBase: string;
  accessToken: string;
  /** The connected channel identity (channel id), used as the analytics `ids=channel==` scope. */
  accountRef: string;
  environment: 'production' | 'sandbox';
}

const meta = (connection: PublishingConnection): ConnectorMeta => ({
  id: 'connector:youtube-publish',
  version: '0.1.0',
  platform: 'youtube',
  capabilities: {
    research: false,
    analytics: true,
    publishing: true,
    scheduling: false,
    // Organic publishing NEVER authorizes paid campaign execution.
    paidAds: false,
  },
  authModel: 'oauthUser',
  verificationRef:
    'MARKETING-DATA-SOURCES.md#youtube-publishing-connected-account (wire protocol implemented against the real Data API v3 shapes; production OAuth access NOT verified in this environment — sandbox test-account connection verified, see the W5 evidence file)',
  supportedRegions: ['global'],
  expectedFreshness: 'upload: immediate; analytics: daily totals',
  retentionNote: `connected-account access; publications and analytics carry the '${connection.environment}' environment label from the connection record`,
});

export class YoutubePublishConnector implements MarketingConnector {
  readonly meta: ConnectorMeta;
  /** idempotencyKey -> outcome, so an in-process retry never duplicates a post. */
  private readonly uploaded = new Map<string, PublishOutcome>();

  constructor(
    private readonly connection: PublishingConnection,
    private readonly fetchLike: PublishFetchLike = defaultFetch,
  ) {
    this.meta = meta(connection);
  }

  /** Research is not a capability of this connector — a typed refusal, never a pretend page. */
  async research(_request: ResearchRequest): Promise<ResearchPage> {
    throw new ConnectorFailure({
      kind: 'permission_denied',
      operation: 'research',
      policy: 'connector:youtube-publish declares analytics+publishing only — research lives on connector:youtube-public / connector:google-ads-transparency',
    });
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.get(`${this.connection.dataBase}/youtube/v3/videos?part=status&id=dQw4w9WgXcQ`);
      if (res.status === 200) {
        return { ok: true, detail: `connected account '${this.connection.label}' reachable (${this.connection.environment})` };
      }
      return { ok: false, detail: `account endpoint answered HTTP ${res.status} — see the typed error from the last operation` };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    const known = this.uploaded.get(request.idempotencyKey);
    if (known) return known;
    if (!request.asset) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'not_connected',
        detail: 'publish() on a connected account requires the asset bytes + platform metadata (asset field) — use the assisted handoff path for pack-only artifacts',
      });
    }
    const { asset } = request;

    // Step 1 — resumable session initiation with the video metadata.
    const initUrl = `${this.connection.dataBase}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;
    const init = await this.fetchLike(initUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.connection.accessToken}`,
        'content-type': 'application/json',
        // Connector-level idempotency hint; the caller's persisted
        // PublicationRecord is the durable guarantee for cross-process retries.
        'x-idempotency-key': request.idempotencyKey,
      },
      body: JSON.stringify({
        snippet: {
          title: asset.title,
          description: asset.description,
          tags: asset.tags,
          categoryId: '22', // People & Blogs (safe default for organic brand content)
        },
        status: { privacyStatus: asset.privacyStatus, selfDeclaredMadeForKids: false },
      }),
    });
    this.assertOk(init.status, 'upload session initiation');
    const sessionUrl = init.headers['location'];
    if (!sessionUrl) {
      throw new ConnectorFailure({
        kind: 'schema_drift',
        expectedVersion: 'resumable-upload-v3',
        gotVersion: 'missing Location header',
      });
    }

    // Step 2 — upload the bytes to the session URL.
    const upload = await this.fetchLike(sessionUrl, {
      method: 'PUT',
      headers: {
        ...(asset.mimeType ? { 'content-type': asset.mimeType } : {}),
        'content-length': String(asset.bytes.byteLength),
      },
      body: asset.bytes,
    });
    this.assertOk(upload.status, 'video upload');
    let video: { id?: string; status?: { uploadStatus?: string; privacyStatus?: string } };
    try {
      video = JSON.parse(upload.body) as typeof video;
    } catch {
      throw new ConnectorFailure({
        kind: 'schema_drift',
        expectedVersion: 'video-resource-v3',
        gotVersion: `non-JSON upload response (${upload.body.slice(0, 120)})`,
      });
    }
    if (!video.id) {
      throw new ConnectorFailure({
        kind: 'schema_drift',
        expectedVersion: 'video-resource-v3',
        gotVersion: 'response carried no video id',
      });
    }
    const outcome: PublishOutcome = {
      externalPostId: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      assistedHandoff: false,
    };
    this.uploaded.set(request.idempotencyKey, outcome);
    return outcome;
  }

  async verifyPublication(input: { externalPostId: string }): Promise<PublicationVerification> {
    const res = await this.get(
      `${this.connection.dataBase}/youtube/v3/videos?part=status,snippet&id=${encodeURIComponent(input.externalPostId)}`,
    );
    this.assertOk(res.status, 'post-status verification');
    let page: { items?: Array<{ id: string; snippet?: { title?: string; publishedAt?: string }; status?: { uploadStatus?: string; privacyStatus?: string } }> };
    try {
      page = JSON.parse(res.body) as typeof page;
    } catch {
      throw new ConnectorFailure({
        kind: 'schema_drift',
        expectedVersion: 'video-list-v3',
        gotVersion: `non-JSON videos.list response (${res.body.slice(0, 120)})`,
      });
    }
    const item = page.items?.find((v) => v.id === input.externalPostId);
    if (!item) {
      return {
        exists: false,
        detail: `videos.list answered but post '${input.externalPostId}' is not on the connected account`,
      };
    }
    return {
      exists: true,
      ...(item.status?.uploadStatus ? { uploadStatus: item.status.uploadStatus } : {}),
      ...(item.status?.privacyStatus ? { privacyStatus: item.status.privacyStatus } : {}),
      ...(item.snippet?.title ? { title: item.snippet.title } : {}),
      ...(item.snippet?.publishedAt ? { publishedAt: item.snippet.publishedAt } : {}),
      detail: `verified through the connected account '${this.connection.label}' (videos.list; uploadStatus ${item.status?.uploadStatus ?? 'unknown'})`,
    };
  }

  async analytics(request: AnalyticsRequest): Promise<AnalyticsPage> {
    const observations: MetricObservation[] = [];
    const coverage: AnalyticsPage['coverage'] = [];
    for (const externalId of request.subjectExternalIds) {
      const url =
        `${this.connection.analyticsBase}/v2/reports` +
        `?ids=${encodeURIComponent(`channel==${this.connection.accountRef}`)}` +
        `&metrics=${encodeURIComponent(request.metrics.join(','))}` +
        `&start=${request.from.slice(0, 10)}&end=${request.to.slice(0, 10)}` +
        `&filters=${encodeURIComponent(`video==${externalId}`)}`;
      const res = await this.get(url);
      this.assertOk(res.status, `analytics for ${externalId}`);
      let report: { columnHeaders?: Array<{ name: string; columnType: string; dataType: string }>; rows?: string[][] | number[][] };
      try {
        report = JSON.parse(res.body) as typeof report;
      } catch {
        throw new ConnectorFailure({
          kind: 'schema_drift',
          expectedVersion: 'yt-analytics-report-v2',
          gotVersion: `non-JSON analytics response (${res.body.slice(0, 120)})`,
        });
      }
      const headers = (report.columnHeaders ?? []).map((h) => h.name);
      const dayIndex = headers.indexOf('day');
      for (const metric of request.metrics) {
        const metricIndex = headers.indexOf(metric);
        if (dayIndex === -1 || metricIndex === -1) continue;
        for (const row of report.rows ?? []) {
          const day = String(row[dayIndex]);
          const value = Number(row[metricIndex]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(value)) continue;
          observations.push({
            kind: 'MetricObservation',
            id: `ytanalytics:${externalId}:${metric}:${day}`,
            missionId: request.missionId,
            subjectRef: `yt:${externalId}`,
            metricKey: metric,
            value,
            observedAt: `${day}T00:00:00.000Z`,
            source: {
              sourceId: `connected-account:${this.connection.connectionId}`,
              sourceRecordId: externalId,
              connectorVersion: this.meta.version,
            },
            metricDefinition: 'connected-account-analytics',
            metricDefinitionVersion: 'yt-analytics-v1',
          });
        }
      }
      const rows = observations.filter((o) => o.source.sourceRecordId === externalId).length;
      coverage.push({
        slice: `connected-analytics:${externalId}`,
        state: rows > 0 ? 'available' : 'unavailable',
        sourceId: this.meta.id,
        connectorVersion: this.meta.version,
        note:
          rows > 0
            ? `${rows} daily observations through the connected account '${this.connection.label}' (${this.connection.environment} environment; platform-reported daily totals)`
            : `no analytics rows returned for post '${externalId}' in the requested window through '${this.connection.label}'`,
      });
    }
    if (coverage.length === 0) {
      coverage.push({
        slice: 'connected-analytics',
        state: 'unavailable',
        sourceId: this.meta.id,
        connectorVersion: this.meta.version,
        note: 'no subjects requested — nothing collected',
      });
    }
    return { observations, coverage, accessMethod: 'authorizedAccount' };
  }

  private async get(url: string): Promise<{ status: number; body: string }> {
    const res = await this.fetchLike(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.connection.accessToken}` },
    });
    return { status: res.status, body: res.body };
  }

  /** Maps platform HTTP statuses to the typed error contract (never stringly failures). */
  private assertOk(status: number, operation: string): void {
    if (status >= 200 && status < 300) return;
    if (status === 401 || status === 403) {
      throw new ConnectorFailure(
        status === 401
          ? {
              kind: 'auth_required' as const,
              scope: operation,
              reauthHint: `the connected account '${this.connection.label}' rejected the request — reconnect the account`,
            }
          : {
              kind: 'permission_denied' as const,
              operation,
              policy: `the connected account '${this.connection.label}' is not permitted to ${operation}`,
            },
      );
    }
    if (status === 429) {
      throw new ConnectorFailure({ kind: 'rate_limited', retryAfterMs: 60_000, quotaScope: `connected-account:${this.connection.connectionId}` });
    }
    if (status >= 500) {
      throw new ConnectorFailure({ kind: 'transient_network', retryable: true, attempt: 1 });
    }
    throw new ConnectorFailure({
      kind: 'schema_drift',
      expectedVersion: 'http-2xx',
      gotVersion: `HTTP ${status} on ${operation}`,
    });
  }
}
