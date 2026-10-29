/**
 * W5 tools — authorized publishing (see docs/marketing/MARKETING-ROADMAP.md):
 * connect an authorized publishing account, publish a user-APPROVED asset
 * through it (idempotent — retries never duplicate the post), verify the
 * resulting post, and record its identity. When no account is connected (or
 * the platform has no publishing integration), the ASSISTED handoff path
 * carries the same metadata package out for manual publishing, and the manual
 * publication comes back verified through the keyless public route (oEmbed).
 *
 * Organic publishing NEVER authorizes paid campaign execution — the connector
 * capability set is the enforcement, and every publication record carries the
 * connection's environment label (a sandbox test-account post is never
 * presented as a production post).
 */
import { z } from 'zod';
import { publicationRecord } from '@zcode/marketing';
import type { CreativeArtifact } from '@zcode/marketing';
import { MarketingToolError, type MarketingRuntime } from './runtime.js';
import type { ToolRegistrar } from './toolRegistrar.js';

const CONNECTION_HINT =
  'dataBase defaults to the real YouTube Data API (https://www.googleapis.com); a connected test account (sandbox) points dataBase at the test endpoint instead. The access token is stored in the workspace credential area and NEVER returned by any tool.';

/** Composes the platform publishing metadata from the artifact + its pack. */
export function composePublishMetadata(
  artifact: CreativeArtifact,
  pack: CreativeArtifact | undefined,
  overrides: { title?: string; description?: string; tags?: string[] } = {},
): { title: string; description: string; tags: string[] } {
  const declaration = (artifact.brief as { declaration?: { hookText: string; proofText: string; ctaText: string } })
    .declaration;
  const packCopy = pack?.brief as { generatorPromptPacks?: { copy?: { titleVariants?: string[]; ctaLine?: string } } } | undefined;
  const title =
    overrides.title ??
    packCopy?.generatorPromptPacks?.copy?.titleVariants?.[0] ??
    declaration?.hookText ??
    `${artifact.id} (untitled)`;
  const description =
    overrides.description ??
    (declaration
      ? [declaration.hookText, '', declaration.proofText, '', declaration.ctaText].join('\n')
      : 'produced from the mission creative pack');
  const tags =
    overrides.tags ?? [
      'zcode-marketing',
      ...String(title)
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length >= 4)
        .slice(0, 6),
    ];
  return { title: title.slice(0, 100), description: description.slice(0, 5000), tags: tags.slice(0, 12) };
}

/** Publishable states: approved for the first publish, published for idempotent replays. */
const publishGate = (artifact: CreativeArtifact): void => {
  if (artifact.status !== 'approved' && artifact.status !== 'published') {
    throw new MarketingToolError(
      'approval_required',
      `artifact ${artifact.id} is '${artifact.status}' — publishing requires the explicit W4 approval (marketing_review_artifact approve)`,
    );
  }
};

/** After a real publication the artifact carries the published state (audit trail). */
const markArtifactPublished = async (
  runtime: MarketingRuntime,
  missionId: string,
  artifact: CreativeArtifact,
): Promise<void> => {
  if (artifact.status === 'published') return;
  await runtime.saveArtifact(missionId, { ...artifact, status: 'published' });
};

export function registerW5Tools(register: ToolRegistrar, runtime: MarketingRuntime): void {
// ---------------------------------------------------------------
// W5 — Authorized publishing. Approval is explicit (W4 status gate),
// publication is idempotent, the post is verified and its identity
// recorded; the assisted path serves every unconnected case honestly.
// ---------------------------------------------------------------
register(
  'marketing_connect_publish_account',
  {
    description:
      `Connect an authorized publishing account (W5): the account is validated through its connector health check BEFORE it is persisted; one connection per platform (connecting again replaces it). ${CONNECTION_HINT} Every mission of that platform picks the publishing capability up on its next tool call.`,
    input: {
      platform: z
        .enum(['youtube', 'tiktok', 'meta', 'other'])
        .default('youtube')
        .describe('Publishing platform — only connectors verified in MARKETING-DATA-SOURCES.md can connect (youtube today).'),
      label: z.string().min(1).max(200).describe('Human label for the account, e.g. "brand test channel".'),
      accessToken: z.string().min(1).max(4096).describe('OAuth access token for the account (never echoed back).'),
      dataBase: z.string().url().default('https://www.googleapis.com').describe('Data API base URL.'),
      analyticsBase: z
        .string().url()
        .optional()
        .describe('Analytics API base URL; defaults to the real YouTube Analytics host (or dataBase for test endpoints).'),
      accountRef: z.string().min(1).max(200).describe('The connected channel identity (channel id).'),
      environment: z
        .enum(['production', 'sandbox'])
        .default('production')
        .describe("'sandbox' labels every publication from this account as a test-account post (never presented as production)."),
      connectedBy: z.string().min(1).max(200).describe('Who connected the account (user name or role) — recorded.'),
    },
    output: {
      connection: z.object({
        connectionId: z.string(),
        label: z.string(),
        platform: z.string(),
        environment: z.enum(['production', 'sandbox']),
        accountRef: z.string(),
        connectedAt: z.string(),
        connectedBy: z.string(),
      }),
    },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const view = await runtime.connectAccount({
      platform: input.platform,
      label: input.label,
      dataBase: input.dataBase,
      analyticsBase:
        input.analyticsBase ??
        (input.dataBase.includes('googleapis.com') ? 'https://youtubeanalytics.googleapis.com' : input.dataBase),
      accessToken: input.accessToken,
      accountRef: input.accountRef,
      environment: input.environment,
      connectedBy: input.connectedBy,
    });
    const text = [
      `Publishing account connected: ${view.label} (${view.connectionId}, ${view.environment}).`,
      view.environment === 'sandbox'
        ? 'SANDBOX environment: every publication through this account is labeled as a test-account post.'
        : 'Production environment: publications go to the real platform account.',
      'Approved assets of this platform can now be published with marketing_publish_asset.',
    ].join('\n');
    return { text, structured: { connection: view } };
  },
);

register(
  'marketing_list_connections',
  {
    description: 'List connected publishing accounts (token-free views only — the access token never leaves the credential area).',
    input: {},
    output: {
      connections: z.array(
        z.object({
          connectionId: z.string(),
          label: z.string(),
          platform: z.string(),
          environment: z.enum(['production', 'sandbox']),
          accountRef: z.string(),
          connectedAt: z.string(),
          connectedBy: z.string(),
        }),
      ),
    },
    readOnly: true,
    panel: true,
  },
  async () => {
    const connections = await runtime.connections.views();
    const text = [
      connections.length === 0
        ? 'No connected publishing accounts — connect one with marketing_connect_publish_account or use the assisted handoff path (marketing_assisted_handoff).'
        : `Connected publishing accounts:`,
      ...connections.map(
        (c) => `- ${c.label} (${c.connectionId}) platform ${c.platform} [${c.environment}] account ${c.accountRef}`,
      ),
    ].join('\n');
    return { text, structured: { connections } };
  },
);

register(
  'marketing_publish_asset',
  {
    description:
      'Publish an APPROVED produced asset through the connected publishing account (W5 gate): the file bytes travel the connector contract (resumable upload), the publication is idempotent (retrying returns the SAME post — never a duplicate), and the resulting post identity (external id + URL) is recorded. The artifact must be an approved uploaded asset (marketing_record_asset + marketing_review_artifact).',
    input: {
      missionId: z.string().min(1),
      artifactId: z.string().min(1),
      approvedBy: z.string().min(1).max(200).describe('Who authorizes this publication (recorded on the publication).'),
      title: z.string().max(100).optional().describe('Override the composed title.'),
      description: z.string().max(5000).optional().describe('Override the composed description.'),
      tags: z.array(z.string().max(60)).max(12).optional().describe('Override the composed tags.'),
      privacyStatus: z.enum(['public', 'unlisted', 'private']).default('public'),
    },
    output: { publication: publicationRecord, idempotentReplay: z.boolean() },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const artifact = await runtime.getArtifact(input.missionId, input.artifactId);
    publishGate(artifact);
    if (artifact.kindOf !== 'uploadedAsset') {
      throw new MarketingToolError(
        'invalid_input',
        `artifact ${input.artifactId} is a '${artifact.kindOf}' — only produced assets (marketing_record_asset) can be published; for the pack itself use the assisted handoff (marketing_assisted_handoff)`,
      );
    }
    // Idempotency first: a persisted record with the same key IS the answer.
    const idempotencyKey = `${artifact.id}:${input.missionId}:organic`;
    const existing = await runtime.findPublicationByIdempotencyKey(input.missionId, idempotencyKey);
    if (existing) {
      const text = [
        `Publication ${existing.id} for artifact ${artifact.id} already exists — idempotent replay, no new post created.`,
        `post: ${existing.externalPostId ?? 'n/a'} (${existing.url ?? 'no url'}) status ${existing.status}${existing.environment === 'sandbox' ? ' [SANDBOX test account]' : ''}.`,
      ].join('\n');
      return { text, structured: { publication: existing, idempotentReplay: true } };
    }
    const connection = await runtime.connections.find('youtube');
    if (!connection) {
      throw new MarketingToolError(
        'auth_required',
        'no connected publishing account — connect one with marketing_connect_publish_account, or use the assisted handoff path: marketing_assisted_handoff + marketing_record_manual_publication',
      );
    }
    const file = await runtime.readArtifactFile(artifact);
    const pack = artifact.brief && typeof artifact.brief === 'object'
      ? await runtime
          .getArtifact(input.missionId, String((artifact.brief as { producedFrom?: string }).producedFrom ?? ''))
          .catch(() => undefined)
      : undefined;
    const metadata = composePublishMetadata(artifact, pack, {
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    });
    const record = await loaded.mission.publish(artifact, input.approvedBy, {
      connectionId: connection.connectionId,
      environment: connection.environment,
      asset: {
        bytes: file.bytes,
        mimeType: file.name.endsWith('.png') || file.name.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4',
        ...metadata,
        privacyStatus: input.privacyStatus,
      },
    });
    await runtime.savePublication(input.missionId, record);
    await markArtifactPublished(runtime, input.missionId, artifact);
    const text = [
      `Published ${file.name} (${file.bytes.byteLength} bytes) through '${connection.label}' — post ${record.externalPostId}.`,
      `url: ${record.url ?? 'n/a'}`,
      `status: ${record.status}${record.environment === 'sandbox' ? ' [SANDBOX test account — not a production post]' : ''}`,
      `idempotency key ${record.idempotencyKey} — retries return this same post, never a duplicate.`,
      'Verify the resulting post with marketing_verify_publication; open the measurement window with marketing_open_experiment.',
    ].join('\n');
    return { text, structured: { publication: record, idempotentReplay: false } };
  },
);

register(
  'marketing_assisted_handoff',
  {
    description:
      'Generate the assisted publishing package for an approved artifact (W5 manual path — for platforms/accounts without a direct publishing integration): copy-ready title/description/tags, the asset file location, and the upload steps. After the user publishes manually, bring the post back with marketing_record_manual_publication (verified through the keyless public route).',
    input: { missionId: z.string().min(1), artifactId: z.string().min(1) },
    output: {
      package: z.object({
        title: z.string(),
        description: z.string(),
        tags: z.array(z.string()),
        file: z.object({ name: z.string(), bytes: z.number(), path: z.string() }).optional(),
        steps: z.array(z.string()),
      }),
    },
    readOnly: true,
    panel: true,
  },
  async (input) => {
    const artifact = await runtime.getArtifact(input.missionId, input.artifactId);
    if (artifact.status !== 'approved' && artifact.status !== 'published') {
      throw new MarketingToolError(
        'approval_required',
        `artifact ${input.artifactId} is '${artifact.status}' — the assisted package also requires the explicit W4 approval`,
      );
    }
    const pack = artifact.kindOf === 'uploadedAsset'
      ? await runtime
          .getArtifact(input.missionId, String((artifact.brief as { producedFrom?: string }).producedFrom ?? ''))
          .catch(() => undefined)
      : undefined;
    const metadata = composePublishMetadata(artifact, pack);
    const file = artifact.kindOf === 'uploadedAsset'
      ? await runtime.readArtifactFile(artifact).catch(() => undefined)
      : undefined;
    const steps = [
      `open your channel's upload page and select the produced file${file ? ` (${file.path})` : ''}`,
      `paste the title: "${metadata.title}"`,
      'paste the description (hook, proof, CTA lines are pre-composed)',
      `add the tags: ${metadata.tags.join(', ')}`,
      'publish, then record the resulting URL with marketing_record_manual_publication — the system verifies it through the keyless public oEmbed route',
    ];
    const text = [
      `Assisted publishing package for ${artifact.id}:`,
      `- title: ${metadata.title}`,
      `- description: ${metadata.description.split('\n')[0]}…`,
      `- tags: ${metadata.tags.join(', ')}`,
      file ? `- file: ${file.name} (${file.bytes.byteLength} bytes) at ${file.path}` : '- file: none imported (pack-only artifact — produce and import the asset first for a complete package)',
      ...steps.map((s, i) => `${i + 1}. ${s}`),
    ].join('\n');
    return {
      text,
      structured: {
        package: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          ...(file ? { file: { name: file.name, bytes: file.bytes.byteLength, path: file.path } } : {}),
          steps,
        },
      },
    };
  },
);

register(
  'marketing_record_manual_publication',
  {
    description:
      'Record a manually published post (W5 assisted path): the user attests the URL of the post they published from the assisted package. The system VERIFIES the post through the keyless public route (oEmbed) — a resolvable public URL becomes a verified publication; an unresolvable one is recorded as user-attested only, never as verified.',
    input: {
      missionId: z.string().min(1),
      artifactId: z.string().min(1),
      url: z.string().url().describe('The public URL of the published post, e.g. https://www.youtube.com/watch?v=…'),
      publishedBy: z.string().min(1).max(200).describe('Who published manually (attested, recorded).'),
      notes: z.string().max(2000).optional(),
    },
    output: { publication: publicationRecord },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const artifact = await runtime.getArtifact(input.missionId, input.artifactId);
    if (artifact.status !== 'approved' && artifact.status !== 'published') {
      throw new MarketingToolError(
        'approval_required',
        `artifact ${input.artifactId} is '${artifact.status}' — manual publication recording also requires the explicit W4 approval`,
      );
    }
    const existing = await runtime.findPublicationByIdempotencyKey(
      input.missionId,
      `${artifact.id}:${input.missionId}:organic`,
    );
    if (existing) {
      throw new MarketingToolError(
        'invalid_input',
        `artifact ${artifact.id} already has publication ${existing.id} (${existing.status}) — one publication per artifact; verify it with marketing_verify_publication instead`,
      );
    }
    const verification = await runtime.verifyPublicVideo(input.url);
    const videoId = /[?&]v=([\w-]{6,})/.exec(input.url)?.[1];
    const record = publicationRecord.parse({
      kind: 'PublicationRecord',
      id: `publication-manual-${artifact.id}-${Date.now()}`,
      missionId: input.missionId,
      artifactId: artifact.id,
      platform: loaded.entry.brief.platform,
      idempotencyKey: `${artifact.id}:${input.missionId}:organic`,
      externalPostId: videoId,
      url: input.url,
      approvedBy: input.publishedBy,
      publishedAt: new Date().toISOString(),
      status: verification.exists ? 'verified' : 'published',
      assistedHandoff: true,
      environment: 'production',
      ...(verification.exists
        ? {
            verification: {
              method: 'public-oembed' as const,
              verifiedAt: new Date().toISOString(),
              detail: `${verification.detail}${verification.title ? ` — "${verification.title}"` : ''}`,
            },
          }
        : {
            verification: {
              method: 'user-attested' as const,
              verifiedAt: new Date().toISOString(),
              detail: `not resolvable through the keyless public route (${verification.detail}) — recorded as user-attested only`,
            },
          }),
    });
    await runtime.savePublication(input.missionId, record);
    await markArtifactPublished(runtime, input.missionId, artifact);
    const text = [
      `Manual publication recorded for artifact ${artifact.id}: ${input.url}`,
      verification.exists
        ? `VERIFIED through the keyless public route${verification.title ? ` — "${verification.title}"` : ''}.`
        : `NOT verifiable through the keyless public route — recorded as user-attested only (${verification.detail}).`,
      'Next: open the measurement window with marketing_open_experiment.',
    ].join('\n');
    return { text, structured: { publication: record } };
  },
);

register(
  'marketing_verify_publication',
  {
    description:
      'Verify the resulting post of a publication (W5 gate): connected-account publications re-check through videos.list (the connected account route); manual publications re-check through the keyless public oEmbed route. Updates the publication status to verified/failed and records HOW it was verified.',
    input: { missionId: z.string().min(1), publicationId: z.string().min(1) },
    output: { publication: publicationRecord },
    readOnly: false,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const record = await runtime.getPublication(input.missionId, input.publicationId);
    if (record.connectionId && record.externalPostId) {
      if (!loaded.connector.verifyPublication) {
        throw new MarketingToolError('auth_required', 'the publishing connection is no longer available — reconnect the account');
      }
      const verification = await loaded.connector.verifyPublication({ externalPostId: record.externalPostId });
      const next = publicationRecord.parse({
        ...record,
        status: verification.exists ? 'verified' : 'failed',
        ...(verification.exists
          ? {
              verification: {
                method: 'connected-account' as const,
                verifiedAt: new Date().toISOString(),
                detail: verification.detail,
              },
            }
          : {
              verification: {
                method: 'connected-account' as const,
                verifiedAt: new Date().toISOString(),
                detail: `${verification.detail} — post no longer present on the connected account`,
              },
            }),
      });
      await runtime.savePublication(input.missionId, next);
      const text = [
        `Publication ${record.id} verification (${next.environment} environment): ${verification.exists ? 'VERIFIED' : 'FAILED'}.`,
        verification.detail,
      ].join('\n');
      return { text, structured: { publication: next } };
    }
    if (record.url) {
      const verification = await runtime.verifyPublicVideo(record.url);
      const next = publicationRecord.parse({
        ...record,
        status: verification.exists ? 'verified' : 'failed',
        verification: {
          method: verification.exists ? ('public-oembed' as const) : ('user-attested' as const),
          verifiedAt: new Date().toISOString(),
          detail: verification.detail,
        },
      });
      await runtime.savePublication(input.missionId, next);
      const text = [
        `Publication ${record.id} verification (public route): ${verification.exists ? 'VERIFIED' : 'FAILED'}.`,
        verification.detail,
      ].join('\n');
      return { text, structured: { publication: next } };
    }
    throw new MarketingToolError(
      'invalid_input',
      `publication ${record.id} has neither a connected-account post id nor a URL — nothing to verify`,
    );
  },
);

register(
  'marketing_list_publications',
  {
    description:
      'List the mission loop state (W5/W6): publication records with statuses and environment labels, experiments with their preserved forecasts and recorded results, simulation runs with appended calibration history, and the next-action recommendations.',
    input: { missionId: z.string().min(1) },
    output: {
      publications: z.array(publicationRecord),
      experiments: z.array(z.record(z.string(), z.unknown())),
      simulations: z.array(z.record(z.string(), z.unknown())),
      nextActions: z.array(z.record(z.string(), z.unknown())),
    },
    readOnly: true,
    panel: true,
  },
  async (input) => {
    const loaded = await runtime.open(input.missionId);
    const { publications, experiments, simulations, nextActions } = loaded.artifacts;
    const text = [
      `Loop state for ${input.missionId}:`,
      ...publications.map(
        (p) =>
          `- publication ${p.id} (${p.status}${p.environment === 'sandbox' ? ', SANDBOX' : ''}) artifact ${p.artifactId} -> ${p.externalPostId ?? p.url ?? 'assisted'}${p.verification ? ` [${p.verification.method}]` : ''}`,
      ),
      ...experiments.map(
        (e) =>
          `- experiment ${e.id} on ${e.publicationId} (${e.result ? `completed: ${e.result.observedValue} on ${e.result.observedMetricKey}` : `measuring, window ${e.measurementWindowDays}d`})`,
      ),
      ...simulations.map((s) => `- simulation ${s.id} (${s.calibrationHistory.length} calibration entries, ${s.modelRef})`),
      ...nextActions.map((a) => `- next action ${a.id}: ${a.recommendation.slice(0, 120)}…`),
    ].join('\n');
    return { text, structured: { publications, experiments, simulations, nextActions } };
  },
);
}
