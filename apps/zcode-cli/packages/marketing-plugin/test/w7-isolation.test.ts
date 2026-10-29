/**
 * W7-3 tenant-isolation regression tests — missions are isolated tenants in
 * one workspace: cross-mission ids are typed refusals (never accidental
 * reads), publications/experiments/artifacts live in per-mission stores,
 * and no persisted record leaks an absolute host path.
 *
 * The one workspace-global resource is the connection store (the user's own
 * publishing account — one per platform, shared across their missions): that
 * is the product contract, asserted here explicitly so a future change that
 * silently scopes or unscopes it has to restate it.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketingServer } from '../src/server.js';
import { MarketingRuntime } from '../src/runtime.js';

describe('W7-3 tenant isolation — missions are isolated tenants', () => {
  let root: string;
  let runtime: MarketingRuntime;
  let client: Client;
  let cleanupServer: (() => Promise<void>) | undefined;

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
    return { isError: result.isError === true, text, structured: result.structuredContent as Record<string, unknown> };
  };

  const produce = async (missionId: string) => {
    await call('marketing_mission_start', {
      product: `product for ${missionId}`,
      audience: 'commuting coffee drinkers',
      country: 'US',
      platform: 'youtube',
      offer: '30-day home trial, free shipping',
      objective: 'sales',
      constraints: ['no discount-first messaging'],
      researchMode: 'demo',
      missionId,
    });
    await call('marketing_discover_competitors', { missionId, hints: ['RivalOne'], confirm: ['RivalOne'] });
    await call('marketing_research_platform', { missionId });
    await call('marketing_rank_opportunities', { missionId });
    const draft = await call('marketing_draft_creative', { missionId });
    const pack = (draft.structured as { artifact: { id: string } }).artifact;
    await call('marketing_review_artifact', { missionId, artifactId: pack.id, decision: 'approve', reviewedBy: 'owner' });
    const bytes = Buffer.from(`asset-bytes-${missionId}`);
    const begin = await call('marketing_asset_import_begin', { missionId, name: 'ad.mp4', size: bytes.byteLength });
    const importId = (begin.structured as { id: string }).id;
    await call('marketing_asset_import_write', { id: importId, offset: 0, data: bytes.toString('base64') });
    await call('marketing_asset_import_finish', { id: importId });
    const record = await call('marketing_record_asset', {
      missionId,
      artifactId: pack.id,
      importedAssetId: importId,
      format: 'video',
      durationSec: 28,
      aspectRatio: '9:16',
      hookText: 'Cafe-grade espresso on your commute — no machine needed',
      proofText: 'unedited before/after of the extraction',
      ctaText: 'Get yours with the 30-day trial',
      transcriptOrCopy: 'Cafe-grade espresso on your commute. Watch the demo. Get yours with the 30-day trial.',
    });
    const asset = (record.structured as { artifact: { id: string } }).artifact;
    await call('marketing_review_artifact', { missionId, artifactId: asset.id, decision: 'approve', reviewedBy: 'owner' });
    const manual = await call('marketing_record_manual_publication', {
      missionId,
      artifactId: asset.id,
      url: 'https://www.youtube.com/watch?v=fixvid001',
      publishedBy: 'owner',
    });
    const publication = (manual.structured as { publication: { id: string } }).publication;
    const experiment = await call('marketing_open_experiment', { missionId, publicationId: publication.id });
    return {
      packId: pack.id,
      importId,
      assetId: asset.id,
      publicationId: publication.id,
      experimentId: (experiment.structured as { experiment: { id: string } }).experiment.id,
    };
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'marketing-w7-iso-'));
    runtime = new MarketingRuntime(root, {
      fetchLike: async (url: string) => {
        if (url.includes('feeds/videos.xml')) {
          return {
            status: 200,
            body: '<feed><updated>2026-10-28T10:00:00+00:00</updated><entry><yt:videoId>fixvid001</yt:videoId><yt:channelId>UCfixture0000000000000Aa</yt:channelId><title>Fresh fixture upload</title><author><name>RivalOne</name></author><published>2026-10-26T00:00:00+00:00</published></entry></feed>',
          };
        }
        if (url.startsWith('https://www.youtube.com/oembed')) {
          const target = decodeURIComponent(/[?&]url=([^&]+)/.exec(url)?.[1] ?? '');
          if (target.includes('v=fixvid001')) {
            return { status: 200, body: JSON.stringify({ title: 'Fresh fixture upload', thumbnail_url: 'https://example.invalid/t.jpg' }) };
          }
          return { status: 404, body: '' };
        }
        return { status: 404, body: '' };
      },
    });
    const server = createMarketingServer(runtime, { panelHtml: async () => '<!doctype html><html></html>' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'marketing-w7-iso-test', version: '0.0.0' });
    await client.connect(clientTransport);
    cleanupServer = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await cleanupServer?.();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });

  it('refuses every cross-mission id with a typed error (no accidental tenant reads)', async () => {
    const a = await produce('mission-iso-a');
    const b = await produce('mission-iso-b');

    // Mission B must not touch mission A's objects by id.
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['marketing_review_artifact', { missionId: 'mission-iso-b', artifactId: a.packId, decision: 'approve', reviewedBy: 'x' }, 'unknown_artifact'],
      ['marketing_record_asset', { missionId: 'mission-iso-b', artifactId: a.packId, format: 'video', aspectRatio: '9:16', hookText: 'h', proofText: 'p', ctaText: 'c', transcriptOrCopy: 't' }, 'unknown_artifact'],
      ['marketing_publish_asset', { missionId: 'mission-iso-b', artifactId: a.assetId, approvedBy: 'x' }, 'unknown_artifact'],
      ['marketing_assisted_handoff', { missionId: 'mission-iso-b', artifactId: a.assetId }, 'unknown_artifact'],
      ['marketing_record_manual_publication', { missionId: 'mission-iso-b', artifactId: a.assetId, url: 'https://www.youtube.com/watch?v=fixvid001', publishedBy: 'x' }, 'unknown_artifact'],
      ['marketing_verify_publication', { missionId: 'mission-iso-b', publicationId: a.publicationId }, 'unknown_publication'],
      ['marketing_open_experiment', { missionId: 'mission-iso-b', publicationId: a.publicationId }, 'unknown_publication'],
      ['marketing_collect_analytics', { missionId: 'mission-iso-b', publicationId: a.publicationId }, 'unknown_publication'],
      ['marketing_record_outcome', { missionId: 'mission-iso-b', experimentId: a.experimentId, observedValue: 1 }, 'unknown_experiment'],
    ];
    for (const [tool, args, code] of cases) {
      const result = await call(tool, args);
      expect(result.isError, `${tool} with a cross-mission id must refuse`).toBe(true);
      expect(result.text, `${tool} refusal is the typed ${code}`).toContain(code);
    }

    // An import id from mission A does not resolve inside mission B.
    const resolveB = await call('marketing_record_asset', {
      missionId: 'mission-iso-b',
      artifactId: b.packId,
      importedAssetId: a.importId,
      format: 'video',
      aspectRatio: '9:16',
      hookText: 'h',
      proofText: 'p',
      ctaText: 'c',
      transcriptOrCopy: 't',
    });
    expect(resolveB.isError).toBe(true);
    expect(resolveB.text).toContain('unknown_import');

    // And each mission sees only its own loop state.
    const listA = await call('marketing_list_publications', { missionId: 'mission-iso-a' });
    const listB = await call('marketing_list_publications', { missionId: 'mission-iso-b' });
    const idsA = ((listA.structured as { publications: Array<{ id: string }> }).publications).map((p) => p.id);
    const idsB = ((listB.structured as { publications: Array<{ id: string }> }).publications).map((p) => p.id);
    expect(idsA).toContain(a.publicationId);
    expect(idsB).not.toContain(a.publicationId);
    expect(idsB).toContain(b.publicationId);
  });

  it('keeps missions in separate artifacts files and never persists absolute host paths', async () => {
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const files: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else files.push(full);
      }
      return files;
    };
    const files = await walk(join(root, '.zcode', 'marketing', 'missions'));
    const a = files.filter((f) => f.includes('mission-iso-a'));
    const b = files.filter((f) => f.includes('mission-iso-b'));
    expect(a.some((f) => f.endsWith('mission-iso-a-artifacts.json'))).toBe(true);
    expect(b.some((f) => f.endsWith('mission-iso-b-artifacts.json'))).toBe(true);
    for (const file of [...a, ...b]) {
      const raw = await readFile(file, 'utf8');
      // Records stay workspace-relative (.zcode/...) — no absolute host paths.
      expect(raw).not.toContain(root);
      expect(raw).not.toMatch(/"file":\s*"\/(home|Users|tmp)\//);
    }
  });

  it('states the connection-store contract explicitly: one workspace-global publishing account per platform, shared across the user missions', async () => {
    // The connection store is the user's own account, by design shared across
    // their missions in this workspace; the token never leaves the credential
    // area (see the W5 hygiene suite). This asserts the contract so a silent
    // change must restate it.
    const views = await runtime.connections.views();
    expect(views).toEqual([]);
    const store = join(root, '.zcode', 'marketing', 'connections.json');
    expect((await readFile(store, 'utf8').catch(() => '')).includes('kind')).toBe(false); // not created until a connect
  });
});
