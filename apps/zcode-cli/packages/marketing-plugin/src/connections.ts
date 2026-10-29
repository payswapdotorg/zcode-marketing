/**
 * W5 connection store — user-authorized publishing accounts (method 3 in
 * MARKETING-DATA-SOURCES.md), persisted under the mission workspace
 * (`.zcode/marketing/connections.json`).
 *
 * Auth hygiene (PLATFORM-CONNECTOR-CONTRACT.md): the access token lives only in
 * this file and inside connector requests. Every view returned to a tool is
 * token-free; tests grep tool outputs and mission records for the token to
 * keep it that way. Connecting validates the account through the connector's
 * own healthCheck — no bogus connections are ever persisted.
 *
 * Layer: plugin adapters-equivalent boundary — all file I/O lives here.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { MarketingToolError } from './errors.js';

/**
 * W5 connected publishing account (user-authorized method 3). The access token
 * lives ONLY in the store file and inside the connector's requests — it is
 * never returned by a tool, logged, or written into mission records (auth
 * hygiene, grep-enforced by the plugin tests).
 */
export const connectionEntry = z.object({
  connectionId: z.string().min(1),
  label: z.string().min(1).max(200),
  platform: z.enum(['youtube', 'tiktok', 'meta', 'other']),
  dataBase: z.string().url(),
  analyticsBase: z.string().url(),
  accessToken: z.string().min(1),
  accountRef: z.string().min(1),
  environment: z.enum(['production', 'sandbox']),
  connectedAt: z.string().min(1),
  connectedBy: z.string().min(1).max(200),
});
export type ConnectionEntry = z.infer<typeof connectionEntry>;

/** Token-free view of a connection — the only shape tools may return. */
export type ConnectionView = Omit<ConnectionEntry, 'accessToken'>;

const connectionsFile = z.object({
  kind: z.literal('marketing-connections'),
  version: z.literal(1),
  connections: z.array(connectionEntry),
});

export interface ConnectAccountInput {
  label: string;
  platform: 'youtube' | 'tiktok' | 'meta' | 'other';
  dataBase: string;
  analyticsBase: string;
  accessToken: string;
  accountRef: string;
  environment: 'production' | 'sandbox';
  connectedBy: string;
}

/**
 * The health check the store runs before persisting a connection. The runtime
 * injects the real connector check (build the connector for the platform, call
 * its healthCheck with the candidate credentials).
 */
export type ConnectionHealthCheck = (
  input: ConnectAccountInput,
) => Promise<{ ok: boolean; detail: string }>;

export class ConnectionStore {
  private entries?: ConnectionEntry[];

  constructor(
    private readonly filePath: string,
    private readonly now: () => string,
  ) {}

  /** The token-free views — the only shape tools may ever return. */
  async views(): Promise<ConnectionView[]> {
    return (await this.read()).map(({ accessToken: _token, ...view }) => view);
  }

  async find(platform: ConnectionEntry['platform']): Promise<ConnectionEntry | undefined> {
    return (await this.read()).find((c) => c.platform === platform);
  }

  /**
   * Validates the candidate account through the injected health check, then
   * persists it. One connection per platform — connecting again replaces it
   * (label, endpoints, token and environment all update atomically).
   */
  async connect(
    input: ConnectAccountInput,
    healthCheck: ConnectionHealthCheck,
  ): Promise<ConnectionView> {
    if (input.platform !== 'youtube') {
      throw new MarketingToolError(
        'invalid_input',
        `no publishing connector is verified for platform '${input.platform}' — MARKETING-DATA-SOURCES.md lists the verified set; connect a youtube account or use the assisted handoff path`,
      );
    }
    const health = await healthCheck(input);
    if (!health.ok) {
      throw new MarketingToolError(
        'auth_required',
        `the account did not pass its health check and was NOT connected — ${health.detail}`,
      );
    }
    const entries = await this.read();
    const entry = connectionEntry.parse({
      connectionId: `conn-${input.platform}-${Date.now()}`,
      label: input.label,
      platform: input.platform,
      dataBase: input.dataBase,
      analyticsBase: input.analyticsBase,
      accessToken: input.accessToken,
      accountRef: input.accountRef,
      environment: input.environment,
      connectedAt: this.now(),
      connectedBy: input.connectedBy,
    });
    const next = entries.filter((c) => c.platform !== input.platform);
    next.push(entry);
    await this.write(next);
    const { accessToken: _token, ...view } = entry;
    return view;
  }

  private async read(): Promise<ConnectionEntry[]> {
    if (this.entries) return this.entries;
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.entries = connectionsFile.parse(raw).connections;
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  private async write(entries: ConnectionEntry[]): Promise<void> {
    this.entries = entries;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify({ kind: 'marketing-connections', version: 1, connections: entries }, null, 2),
    );
  }
}
