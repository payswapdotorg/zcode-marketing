/**
 * W4 chunked asset imports (office begin/write/finish convention) — the panel
 * streams the produced file into the mission workspace so the mission holds
 * the actual asset, not just a declaration. Byte counts are verified at
 * finish; a mismatch aborts honestly (no half files kept).
 *
 * Extracted from runtime.ts when the file crossed the architecture line
 * budget; the behavior is unchanged (W4 tests keep passing verbatim).
 */
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MarketingToolError } from './errors.js';

interface ImportSession {
  id: string;
  missionId: string;
  name: string;
  declaredBytes: number;
  received: number;
  handle: import('node:fs/promises').FileHandle;
  path: string;
}

export class AssetImportSessions {
  private readonly sessions = new Map<string, ImportSession>();
  private counter = 0;

  constructor(private readonly assetsDirFor: (missionId: string) => string) {}

  async begin(input: { missionId: string; name: string; size: number }): Promise<{ id: string }> {
    const safe = input.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    if (safe.length === 0) throw new MarketingToolError('invalid_input', 'asset name is empty after sanitization');
    if (input.size <= 0 || input.size > 512 * 1024 * 1024) {
      throw new MarketingToolError('invalid_input', 'asset size must be between 1 byte and 512 MiB');
    }
    const id = `asset-${(this.counter += 1)}-${Date.now()}`;
    const dir = this.assetsDirFor(input.missionId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${id}-${safe}`);
    const handle = await open(path, 'wx');
    this.sessions.set(id, {
      id,
      missionId: input.missionId,
      name: safe,
      declaredBytes: input.size,
      received: 0,
      handle,
      path,
    });
    return { id };
  }

  async writeChunk(id: string, offset: number, base64: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new MarketingToolError('unknown_import', `no asset import in progress '${id}'`);
    const chunk = Buffer.from(base64, 'base64');
    if (chunk.byteLength === 0) throw new MarketingToolError('invalid_input', 'empty chunk');
    await session.handle.write(chunk, offset);
    session.received += chunk.byteLength;
  }

  async finish(id: string): Promise<{ name: string; bytes: number; path: string }> {
    const session = this.sessions.get(id);
    if (!session) throw new MarketingToolError('unknown_import', `no asset import in progress '${id}'`);
    if (session.received !== session.declaredBytes) {
      await session.handle.close();
      await unlink(session.path).catch(() => undefined);
      this.sessions.delete(id);
      throw new MarketingToolError(
        'invalid_input',
        `import '${id}' declared ${session.declaredBytes} bytes but received ${session.received} — import aborted, retry from begin`,
      );
    }
    await session.handle.close();
    this.sessions.delete(id);
    return {
      name: session.name,
      bytes: session.received,
      // Workspace-relative so it never leaks an absolute host path into records.
      path: session.path.split('.zcode').pop()!.replace(/^\//, '.zcode/'),
    };
  }

  /** Resolves a completed import's stored file by import id (record step). */
  async resolve(missionId: string, importedAssetId: string): Promise<{ name: string; bytes: number; path: string }> {
    const dir = this.assetsDirFor(missionId);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const match = entries.find((name) => name.startsWith(`${importedAssetId}-`));
    if (!match) {
      throw new MarketingToolError(
        'unknown_import',
        `no imported asset '${importedAssetId}' in mission '${missionId}' — complete a marketing_asset_import_begin/write/finish chain first`,
      );
    }
    const absolute = join(dir, match);
    const info = await stat(absolute);
    return {
      name: match.slice(importedAssetId.length + 1),
      bytes: info.size,
      // Workspace-relative so records never leak absolute host paths.
      path: absolute.split('.zcode').pop()!.replace(/^\//, '.zcode/'),
    };
  }

  /** Closes and discards every in-flight session (runtime close). */
  async abortAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.handle.close().catch(() => undefined);
      await unlink(session.path).catch(() => undefined);
    }
    this.sessions.clear();
  }
}
