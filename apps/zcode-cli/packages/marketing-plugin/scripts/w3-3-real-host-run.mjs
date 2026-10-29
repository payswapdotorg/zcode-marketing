// W3-3 real-host verification driver: drives a FULL marketing mission through
// the ACTUAL ZCode host — `zcode agent-server` (the real CLI entry, the real
// provider registry, the real sampleModel runtime path, the real plugin host
// that spawns the marketing MCP server) — with a personal provider seeded into
// the sandbox provider config pointing at the real GLM chat-completions
// endpoint. The agent (the seeded session model) plans and calls the
// marketing tools itself; the marketing plugin's structured extraction goes
// through sampling/createMessage → the host's provider-routed sampleModel.
//
// This closes the W3-2 residual gap: W3-2 proved the wire path with a
// protocol-conformant stand-in host; THIS run proves the production path in
// the real host process.
//
// Phases (selected with --label):
//   A — routed proof: provider baseUrl = the real GLM endpoint (direct).
//       Gates: marketing tools executed; extraction provenance records
//       `zcode:routed:<model>`; no sampling fallback.
//   B — explicit-fallback proof: provider baseUrl = the deterministic
//       sampling-kill proxy (agent traffic forwarded; sampling 503'd).
//       Gates: marketing tools still executed; extraction provenance records
//       the labeled heuristic fallback with the reason — never silent.
//
// Run A: node scripts/w3-3-real-host-run.mjs --label A
// Run B: node scripts/w3-3-real-host-run.mjs --label B --proxy-port 8642
//        (the proxy from w3-3-sampling-kill-proxy.mjs must be listening, and
//         the provider must have been re-seeded with the proxy base URL)
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..");
const cliRoot = resolve(pluginRoot, ".."); // apps/zcode-cli/packages
const repoRoot = resolve(cliRoot, "..", "..", ".."); // monorepo root

const args = process.argv.slice(2);
const readFlag = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
};
const label = readFlag("--label", "A");
const timeoutMs = Number(readFlag("--timeout-ms", "600000"));
const proxyPort = readFlag("--proxy-port", undefined);
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliMain = join(cliRoot, "cli", "src", "main.ts");

const PROVIDER_ID = "zai-sandbox-glm";
const MODEL_ID = "glm-4-plus";

const MISSION_PROMPT = [
  "Run a marketing intelligence mission end to end using ONLY the marketing_* tools, in this exact order, then stop:",
  `1. marketing_mission_start with: product 'portable espresso maker', audience 'commuting coffee drinkers, 25-40', country 'US', platform 'youtube', offer '30-day home trial, free shipping', objective 'sales', researchMode 'demo', missionId 'mission-w33-${label.toLowerCase()}'.`,
  "2. marketing_discover_competitors with that missionId, hints ['RivalOne','RivalTwo'], confirm ['RivalOne','RivalTwo'].",
  "3. marketing_research_platform with that missionId.",
  "4. marketing_analyze_creative with that missionId.",
  "5. marketing_rank_opportunities with that missionId.",
  "6. marketing_mission_report with that missionId.",
  "Then answer in one short paragraph: state MISSION_DONE, the missionId, and the extraction model refs the report recorded. Do nothing else.",
].join("\n");

const log = (line) => process.stdout.write(`${line}\n`);
const assertGate = (passed, message) => {
  if (passed) {
    log(`  ✔ ${message}`);
    return true;
  }
  log(`  ✘ GATE FAILED: ${message}`);
  process.exitCode = 1;
  return false;
};

function main() {
  const sandbox = mkdtempSync(join(tmpdir(), `w33-host-${label.toLowerCase()}-`));
  // The orchestrator seeds the provider config into a sandbox-isolated
  // ZCODE_DATA_BASE_DIR before launching this driver; honor it so the real
  // host reads the seeded provider registry. Fall back to a fresh dir when
  // invoked directly (a fresh registry will then refuse the session —
  // visible and honest, not a silent pass).
  const dataBaseDir = process.env.ZCODE_DATA_BASE_DIR?.trim() || join(sandbox, "data");
  const workspace = join(sandbox, "workspace");
  mkdirSync(join(dataBaseDir, ".zcode", "v2"), { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const childEnv = {
    ...process.env,
    ZCODE_DATA_BASE_DIR: dataBaseDir,
    HOME: dataBaseDir,
    NO_COLOR: "1",
  };

  log(`== W3-3 real-host run ${label} ==`);
  log(`sandbox: ${sandbox}`);
  log(`host: tsx ${cliMain} agent-server`);
  log(`provider: ${PROVIDER_ID}/${MODEL_ID} (${proxyPort ? `via kill-proxy :${proxyPort}` : "direct GLM endpoint"})`);

  const child = spawn(tsxBin, [cliMain, "agent-server"], {
    cwd: workspace,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderrChunks = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
    if (stderrChunks.join("").length > 400_000) stderrChunks.shift();
  });

  const transcript = [];
  const pending = new Map();
  let nextId = 1;
  let sessionId = null;
  let turnDone = false;
  let turnFailed = false;
  const toolEvents = [];
  const permissionRequests = [];

  // session/event envelopes: {eventId, sessionId, seq, timestamp, type, payload?}
  const recordEvent = (event) => {
    transcript.push({ direction: "event", event });
    if (event.type === "tool.updated") {
      const payload = event.payload ?? {};
      toolEvents.push({ kind: payload.kind, toolName: payload.toolName ?? null, toolCallId: payload.toolCallId });
    }
    if (event.type === "turn.completed") turnDone = true;
    if (event.type === "turn.failed") {
      turnFailed = true;
      turnDone = true;
    }
  };

  const send = (message) => {
    transcript.push({ direction: "client", message });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej, method });
      send({ id, method, params });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rej(new Error(`request ${method} timed out after 120s`));
        }
      }, 120_000);
    });

  child.stdout.setEncoding("utf8");
  let buffer = "";
  const timers = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        transcript.push({ direction: "server-unparseable", raw: line.slice(0, 400) });
        continue;
      }
      transcript.push({ direction: "server", message });
      if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        const entry = pending.get(message.id);
        if (entry) {
          pending.delete(message.id);
          if (message.error) entry.rej(new Error(`${entry.method}: ${message.error.message}`));
          else entry.res(message.result);
        }
        continue;
      }
      if (Object.hasOwn(message, "method")) {
        if (message.id !== undefined) {
          // Reverse request from the host (e.g. runtime preferences, permission approval).
          if (message.method === "session/requestRuntimePreferences") {
            const result = {
              nativeSearchEnhancementsEnabled: false,
              memoryEnabled: false,
              askUserQuestionAutoResolutionEnabled: true,
              toolSearchMode: "off",
            };
            transcript.push({ direction: "client", message: { id: message.id, result }, note: "headless run: default runtime preferences" });
            child.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`);
          } else if (message.method === "interaction/requestPermission") {
            permissionRequests.push(message.params);
            transcript.push({ direction: "client", message: { id: message.id, result: { decision: "allow" } }, note: "auto-allowed permission for headless verification run" });
            child.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: "allow" } })}\n`);
          } else {
            transcript.push({ direction: "client", message: { id: message.id, error: { code: -32001, message: `headless W3-3 run: no handler for ${message.method}` } } });
            child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32001, message: `headless W3-3 run: no handler for ${message.method}` } })}\n`);
          }
          continue;
        }
        // Notification.
        if (message.method === "session/event" && message.params && typeof message.params === "object") {
          const event = message.params;
          if (event.type === "tool.updated" && event.toolName) {
            toolEvents.push({ kind: event.kind, toolName: event.toolName, status: event.status });
          }
          if (event.type === "turn.completed") turnDone = true;
          if (event.type === "turn.failed") {
            turnFailed = true;
            turnDone = true;
          }
        }
      }
    }
  });

  const finish = async (reason) => {
    timers.forEach(clearTimeout);
    try {
      if (sessionId) await request("session/close", { sessionId });
    } catch {
      /* best-effort */
    }
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();

    log(`\n== transcript summary (${reason}) ==`);
    log(`tool events (${toolEvents.length}): ${JSON.stringify(toolEvents)}`);
    log(`permission requests auto-allowed: ${permissionRequests.length}`);

    // Host-side tool names are namespaced (mcp__plugin_marketing_marketing__<tool>)
    // and toolName only rides the "scheduled" event; success ("result"/"error")
    // events carry the toolCallId — correlate by call id.
    const isMarketingTool = (name) => typeof name === "string" && name.includes("marketing__marketing_");
    const marketingNames = new Map(); // toolCallId -> short tool name
    for (const t of toolEvents) {
      if (isMarketingTool(t.toolName)) marketingNames.set(t.toolCallId, t.toolName.split("marketing__marketing_")[1]);
    }
    const marketingTools = [...new Set(marketingNames.values())];
    const succeededMarketing = marketingTools.filter((name) =>
      [...marketingNames.entries()].some(([callId, n]) => n === name && toolEvents.some((t) => t.toolCallId === callId && t.kind === "result")),
    );
    const text = JSON.stringify(transcript);
    const missionsIndex = join(workspace, ".zcode", "marketing", "missions-index.json");
    // Labeled-fallback discipline: every fallback occurrence must carry the
    // heuristic prefix and a reason inside provenance — the pattern count must
    // equal the raw marker count (no unlabeled substitutions).
    const fallbackMarkers = (text.match(/\(fallback:/g) ?? []).length;
    const labeledFallbacks = (text.match(/heuristic:[^"\\]*?\(fallback:[^"\\]*?\)/g) ?? []).length;

    log("\n== gates ==");
    assertGate(sessionId !== null, `session created in the real host (id ${sessionId})`);
    assertGate(toolEvents.length > 0, `tool executions observed in the real agent loop (${toolEvents.length} tool events)`);
    assertGate(marketingTools.length >= 5, `marketing tool chain executed (${marketingTools.length} distinct tools): ${marketingTools.join(", ")}`);
    assertGate(
      marketingTools.length > 0 && marketingTools.every((name) => succeededMarketing.includes(name)),
      `every marketing tool call completed with a result (${succeededMarketing.length}/${marketingTools.length})`,
    );
    assertGate(turnDone && !turnFailed, "turn completed without failure");

    if (label === "A") {
      assertGate(text.includes("zcode:routed:"), "structured extraction routed through the host provider system (zcode:routed: provenance present)");
      assertGate(
        text.includes("zcode:routed:glm-4-plus"),
        "executed model recorded as the real GLM session model (zcode:routed:glm-4-plus — an actual model name, not the documentation placeholder)",
      );
      assertGate(
        fallbackMarkers === labeledFallbacks,
        `every fallback is labeled with reason in provenance (${labeledFallbacks}/${fallbackMarkers} labeled) — no silent substitution`,
      );
      assertGate(existsSync(missionsIndex), "mission persisted in the workspace (missions-index.json)");
    } else if (label === "B") {
      assertGate(text.includes("heuristic:"), "sampling failure fell back to the labeled heuristic adapter (heuristic: provenance present)");
      assertGate(fallbackMarkers > 0, `fallback reason stamped into provenance (${fallbackMarkers} '(fallback:' occurrences) — never silent`);
      assertGate(
        fallbackMarkers === labeledFallbacks,
        `every fallback carries the heuristic prefix and reason (${labeledFallbacks}/${fallbackMarkers} labeled)`,
      );
      // No ACTUAL routed extraction — the literal placeholder string
      // "zcode:routed:<model>" appears in the tools' own provenance explanation
      // text and must not satisfy/mask a real routed model ref. A routed
      // extraction would carry the executed model name (e.g. glm-4-plus).
      const routedRefs = new Set((text.match(/zcode:routed:[^\"\\s)]+/g) ?? []).filter((ref) => !ref.includes("<model>")));
      assertGate(
        routedRefs.size === 0,
        `no routed extraction in run B (sampling deterministically killed; only documentation placeholders present: ${[...routedRefs].slice(0, 3).join(", ")})`,
      );
    }

    log("\n== persistence + stderr tail ==");
    if (existsSync(missionsIndex)) {
      const index = JSON.parse(readFileSync(missionsIndex, "utf8"));
      log(`missions-index.json: ${index.missions.map((m) => `${m.missionId} [${m.researchMode}]`).join(", ")}`);
      const dbPath = join(workspace, ".zcode", "marketing", "missions", `mission-w33-${label.toLowerCase()}.sqlite`);
      if (existsSync(dbPath)) log(`mission sqlite store exists: ${dbPath}`);
    }
    const stderrText = stderrChunks.join("");
    const interesting = stderrText
      .split("\n")
      .filter((l) => /error|warn|fail/i.test(l))
      .slice(-15);
    if (interesting.length) log(`stderr lines of interest:\n${interesting.join("\n")}`);

    // Full transcript dumped to the sandbox for the evidence file (the stdout
    // copy below is truncated to keep runs readable).
    const transcriptPath = join(sandbox, "w33-transcript.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(transcriptPath, JSON.stringify(transcript, null, 1));
    log(`\nfull transcript (${transcript.length} entries): ${transcriptPath}`);

    // Marketing tool outputs of interest, untruncated: the report + provenance.
    const collectStrings = (value, sink) => {
      if (typeof value === "string") sink.push(value);
      else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, sink));
      else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, sink));
    };
    const strings = [];
    collectStrings(transcript, strings);
    const provenanceLines = strings
      .filter((s) => /Extraction models used|extractionModelRef|zcode:routed:|heuristic:|fallback|Provenance is recorded/.test(s))
      .slice(0, 12);
    if (provenanceLines.length) {
      log(`\n== provenance lines of interest ==`);
      for (const line of provenanceLines) log(`- ${line.length > 500 ? `${line.slice(0, 500)}…` : line}`);
    }

    process.stdout.write(`\n== transcript excerpt (first 45 entries) ==\n`);
    process.stdout.write(JSON.stringify(transcript.slice(0, 45), null, 1).slice(0, 30_000));
    process.stdout.write("\n== transcript excerpt end ==\n");
    process.exit(process.exitCode ?? 0);
  };

  timers.push(
    setTimeout(() => {
      log(`timeout after ${timeoutMs}ms`);
      void finish("timeout");
    }, timeoutMs),
  );

  (async () => {
    try {
      log("\n[driver] creating session in the real host…");
      const snapshot = await request("session/create", {
        workspace: { workspacePath: workspace, workspaceKey: workspace },
        model: { providerId: PROVIDER_ID, modelId: MODEL_ID, options: { reasoningLevel: "disabled" } },
        titleGenerationEnabled: false,
        persistence: "immediate",
      });
      sessionId = snapshot?.sessionId ?? snapshot?.session?.sessionId ?? null;
      if (!sessionId) throw new Error(`session/create returned no sessionId: ${JSON.stringify(snapshot).slice(0, 400)}`);
      log(`[driver] session ${sessionId} — sending the mission prompt…`);
      await request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous" });
      // The per-turn selection carries the full options (reasoningLevel) — the
      // session/create mapper flattens `model` to "provider/model" only.
      await request("session/send", {
        sessionId,
        content: MISSION_PROMPT,
        modelSelection: { providerId: PROVIDER_ID, modelId: MODEL_ID, options: { reasoningLevel: "disabled" } },
      });
      // Desktop-continuous delivery routes most events through the v4 channel;
      // the legacy session/events endpoint is the reliable observation path for
      // a minimal headless client — poll it with afterSeq until the turn ends.
      const started = Date.now();
      let afterSeq = 0;
      while (!turnDone && Date.now() - started < timeoutMs - 5_000) {
        try {
          const result = await request("session/events", { sessionId, afterSeq });
          const events = result?.events ?? [];
          for (const event of events) {
            afterSeq = Math.max(afterSeq, event.seq ?? 0);
            recordEvent(event);
          }
        } catch (error) {
          log(`[driver] session/events poll failed: ${String(error)}`);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      try {
        const messages = await request("session/messages", { sessionId });
        transcript.push({ direction: "driver", note: "session/messages snapshot", messages });
      } catch (error) {
        log(`[driver] session/messages failed: ${String(error)}`);
      }
      await finish(turnDone ? (turnFailed ? "turn.failed" : "turn.completed") : "no-completion");
    } catch (error) {
      log(`[driver] fatal: ${String(error)}`);
      await finish("driver-error");
    }
  })();
}

main();
