// W3-2 real-model bridge evidence: drives the FULL marketing tool chain through
// a real spawned stdio MCP server process whose HOST declares the MCP
// `sampling` capability and answers `sampling/createMessage` through a
// pluggable backend. Asserts the W3-2 gates and prints a transcript for
// docs/marketing/evidence/<date>-w3-2-sampling-bridge-run.txt.
//
// Backends:
//  - default: a deterministic in-file backend (protocol-level gate; no network)
//  - W32_SAMPLING_BACKEND=/abs/path/to/backend.mjs — a module default-exporting
//    `async function sample({ systemPrompt, userText, maxTokens }) -> { text, model }`
//    (used with a real-model backend for the recorded evidence run)
//  - W32_DECLINE_ONLY=1 — run only the declined-host phase
//
// Run from the plugin package: pnpm demo:w3-2   (builds dist/server.mjs first)
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const assert = (cond, label) => {
  if (!cond) {
    console.error(`GATE FAILED: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✔ ${label}`);
  }
};

const serverPath = new URL('../dist/server.mjs', import.meta.url).pathname;

/** Deterministic default backend — task-routed JSON answers, no network. */
const deterministicBackend = async ({ systemPrompt, userText }) => {
  const prompt = systemPrompt ?? '';
  if (prompt.includes('product & market researcher')) {
    return {
      text: JSON.stringify({
        competitors: [
          { displayName: 'RivalOne', relevanceReason: 'same category and trial-led offer for the same audience', identityConfidence: 0.9 },
          { displayName: 'RivalTwo', relevanceReason: 'overlapping audience and price segment', identityConfidence: 0.7 },
        ],
      }),
      model: 'deterministic-host-backend',
    };
  }
  if (prompt.includes('creative intelligence analyst')) {
    const parsed = JSON.parse(userText);
    return {
      text: JSON.stringify({
        features: parsed.subjects.map((s) => ({
          subjectRef: s.id,
          hooks: [{ hook: 'benefit-first opening from the routed host model', attentionPattern: 'benefit-led' }],
          narrative: ['benefit reveal', 'proof moment', 'single cta'],
          offerStructure: 'risk-free trial framing',
          visualStructure: 'creator-held handheld demonstration',
        })),
      }),
      model: 'deterministic-host-backend',
    };
  }
  if (prompt.includes('cross-source strategy analyst')) {
    return {
      text: JSON.stringify({
        opportunities: [
          {
            problem: 'benefit claims lack visible proof in competitor ads',
            message: 'show the machine delivering the promised benefit in the first 3 seconds',
            hook: 'benefit-first opening from the routed host model',
            format: '9:16 creator demo, 30s',
            demonstration: 'in-transit espresso pull with visible crema',
            cta: 'single low-friction trial CTA',
            adEvidence: ['ad-rivalone-v0'],
            organicEvidence: ['yt-101'],
            contradictedByRefs: [],
            predictedLow: 6000,
            predictedExpected: 13000,
            predictedHigh: 21000,
            confidence: 0.55,
          },
        ],
      }),
      model: 'deterministic-host-backend',
    };
  }
  return { text: '{}', model: 'deterministic-host-backend' };
};

const loadBackend = async () => {
  const backendPath = process.env.W32_SAMPLING_BACKEND;
  if (!backendPath) return deterministicBackend;
  const mod = await import(pathToFileURL(backendPath).href);
  if (typeof mod.default !== 'function') {
    throw new Error(`W32_SAMPLING_BACKEND must default-export an async function (got ${typeof mod.default})`);
  }
  return mod.default;
};

const show = (text, limit = 1600) => console.log(text.length > limit ? `${text.slice(0, limit)}\n… [truncated]` : text);

/**
 * Spawns the REAL plugin server process and hosts it as a sampling-capable
 * MCP client. decline=true refuses every sampling/createMessage over the wire.
 */
const runPhase = async ({ decline, backend }) => {
  console.log(`\n== phase: ${decline ? 'host declines every sampling request (fallback honesty)' : 'host answers sampling through the backend'} ==`);
  const workspace = await mkdtemp(join(tmpdir(), 'w3-2-sampling-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
  });
  const client = new Client(
    { name: 'w3-2-sampling-evidence', version: '0.0.0' },
    { capabilities: { sampling: {} } },
  );
  let samplingCalls = 0;
  let lastSamplingRequest;
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    samplingCalls += 1;
    if (decline) throw new Error('sampling declined by host policy (evidence decline phase)');
    const params = request.params;
    const userText = Array.isArray(params.messages[0].content)
      ? params.messages[0].content.map((b) => ('text' in b ? b.text : '')).join('\n')
      : String(params.messages[0].content);
    lastSamplingRequest = { systemPrompt: params.systemPrompt, modelPreferences: params.modelPreferences };
    const answer = await backend({ systemPrompt: params.systemPrompt, userText, maxTokens: params.maxTokens });
    return {
      role: 'assistant',
      model: answer.model,
      content: { type: 'text', text: answer.text },
      stopReason: 'endTurn',
    };
  });
  await client.connect(transport);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content ?? []).find((c) => c.type === 'text')?.text ?? '';
    return { isError: result.isError === true, text, structured: result.structuredContent };
  };
  return {
    call,
    stats: { calls: () => samplingCalls, lastRequest: () => lastSamplingRequest },
    finish: async () => {
      await client.close();
      await rm(workspace, { recursive: true, force: true });
    },
  };
};

const MISSION = {
  product: 'portable espresso maker',
  audience: 'commuting coffee drinkers, 25-40',
  country: 'US',
  platform: 'youtube',
  offer: '30-day home trial, free shipping',
  objective: 'sales',
  constraints: ['no discount-first messaging'],
  researchMode: 'demo',
};

const runMissionGates = async (phase, { decline }) => {
  const missionId = decline ? 'mission-w3-2-declined' : 'mission-w3-2-bridge';

  // ---- 1. Onboarding + competitor discovery through the host model
  const start = await phase.call('marketing_mission_start', { ...MISSION, missionId });
  assert(!start.isError, 'mission started (demo mode: real organic side + labeled synthetic paid side)');
  if (!decline) show(start.text);

  const discover = await phase.call('marketing_discover_competitors', {
    missionId,
    // Real brands with real YouTube channels — the recorded evidence run then
    // extracts creative structure from REAL uploads through the real model.
    // (Fictional 'RivalOne'/'RivalTwo' remain covered by the unit tests and
    // the W3-1 chain script, whose fixtures exercise the honest-404 path.)
    hints: ['Wacaco', 'AeroPress'],
    confirm: ['Wacaco', 'AeroPress'],
  });
  assert(!discover.isError, 'competitor discovery returned candidates');

  // ---- 2. Platform research (real keyless YouTube public routes) — W2 gate
  const research = await phase.call('marketing_research_platform', { missionId });
  assert(!research.isError, 'research run through the verified connector chain');
  const again = await phase.call('marketing_research_platform', { missionId });
  assert(
    again.structured?.ingested?.ads === research.structured?.ingested?.ads &&
      again.structured?.ingested?.organic === research.structured?.ingested?.organic,
    'idempotent ingest still holds (W2 gate through the plugin chain)',
  );

  // ---- 3. Creative feature extraction through the sampling channel (W3-2 gate)
  const analyze = await phase.call('marketing_analyze_creative', { missionId });
  assert(!analyze.isError, 'creative analysis succeeded');
  const adFeatures = analyze.structured?.adFeatures ?? [];
  const organicFeatures = analyze.structured?.organicFeatures ?? [];
  assert(adFeatures.length + organicFeatures.length > 0, 'feature sets extracted for observed subjects');
  const allRefs = [...adFeatures, ...organicFeatures].map((f) => f.extractionModelRef);
  if (decline) {
    assert(
      allRefs.every((r) => r.startsWith('heuristic:') && r.includes('(fallback:')),
      'declined host → labeled heuristic fallback with stamped reason in EVERY record',
    );
  } else {
    assert(
      allRefs.every((r) => r.startsWith('zcode:routed:')),
      'host-routed model recorded in EVERY feature set (zcode:routed:<model> provenance)',
    );
  }
  show(analyze.text);
  console.log(`  [sampling calls: ${phase.stats.calls()}; last modelPreferences: ${JSON.stringify(phase.stats.lastRequest()?.modelPreferences)}]`);

  // ---- 4. Paid × organic synthesis through the host model
  const rank = await phase.call('marketing_rank_opportunities', { missionId });
  assert(!rank.isError, 'opportunity ranking succeeded');
  const opportunities = rank.structured?.opportunities ?? [];
  assert(opportunities.length > 0, 'ranked opportunities returned with separated scores');
  const evidenceRefs = opportunities[0]?.hypothesis?.supportedBy?.map((e) => e.ref) ?? [];
  assert(
    evidenceRefs.some((r) => r.startsWith('ad-')) && evidenceRefs.some((r) => r.startsWith('yt')),
    'cross-source evidence discipline intact (paid + organic refs; fixtures use yt-*, real uploads yt:*)',
  );

  // ---- 5. The evidence-backed report states the routing honestly
  const report = await phase.call('marketing_mission_report', { missionId });
  assert(!report.isError, 'mission report composed');
  if (decline) {
    assert(report.text.includes('fell back entirely to the labeled heuristic adapter'), 'report states the fallback honestly');
  } else {
    assert(report.text.includes('host-routed session model'), 'report states the host-routed extraction honestly');
  }
  show(report.text, 2600);
};

const backend = await loadBackend();
console.log(`Marketing plugin W3-2 sampling-bridge evidence run`);
console.log(`Server: ${serverPath}`);
console.log(`Sampling backend: ${process.env.W32_SAMPLING_BACKEND ?? 'deterministic in-file backend (no network)'}`);

try {
  if (process.env.W32_DECLINE_ONLY === '1') {
    const phase = await runPhase({ decline: true, backend });
    await runMissionGates(phase, { decline: true });
    assert(phase.stats.calls() >= 1, `sampling requests were issued over the wire before refusal (${phase.stats.calls()} calls)`);
    await phase.finish();
  } else {
    const phase = await runPhase({ decline: false, backend });
    await runMissionGates(phase, { decline: false });
    assert(phase.stats.calls() >= 3, `sampling channel used for discovery + extraction + synthesis (${phase.stats.calls()} calls)`);
    await phase.finish();

    // Fallback honesty: the same chain under a host that declines everything.
    const declined = await runPhase({ decline: true, backend });
    await runMissionGates(declined, { decline: true });
    assert(declined.stats.calls() >= 1, `sampling requests issued and refused over the wire (${declined.stats.calls()} calls)`);
    await declined.finish();
  }
} catch (error) {
  console.error(`\nW3-2 evidence run crashed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}

console.log('\nDone.');
