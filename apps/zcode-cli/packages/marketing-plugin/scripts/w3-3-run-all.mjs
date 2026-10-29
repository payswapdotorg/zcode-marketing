// W3-3 real-host verification orchestrator — the full P2 evidence run.
//
// Sequence:
//   0. build the plugin dist (server.mjs must be current)
//   1. sandbox-isolated seed of the personal provider config (direct GLM)
//   2. run A — full marketing mission through the REAL host (`agent-server`),
//      gates: routed provenance zcode:routed:<model>, no silent fallback
//   3. start the deterministic sampling-kill proxy; re-seed the provider to it
//   4. run B — same mission; sampling requests get a real upstream-shaped 503;
//      gates: labeled heuristic fallback with reason stamped into provenance
//
// Output is a human-readable evidence transcript intended for
// docs/marketing/evidence/<date>-w3-3-real-host-provider-run.txt.
//
// Run: pnpm demo:w3-3
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..");
const repoRoot = resolve(pluginRoot, "..", "..", "..", "..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

const GLM_BASE_URL = JSON.parse(readFileSync("/etc/.z-ai-config", "utf8")).baseUrl;
const PROXY_PORT = 8642;

const run = (command, args, options = {}) =>
  new Promise((res) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
    child.on("close", (code) => res(code ?? 1));
    child.on("error", (error) => {
      console.error(String(error));
      res(1);
    });
  });

const waitServer = async (port, tries = 50) => {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "GET" });
      if (response.status === 404) return true; // route miss = server listening
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const seed = (sandboxDataDir, baseUrl) =>
  run(tsxBin, [join(here, "w3-3-seed-personal-provider.mts"), "--base-url", baseUrl, "--data-base-dir", sandboxDataDir], {
    cwd: pluginRoot,
  });

console.log("== W3-3: real ZCode-host / real provider-registry verification ==");
console.log(`date: ${new Date().toISOString()}`);
console.log(`host: zcode agent-server (tsx dev entry, real runtime)`);
console.log(`provider: personal provider_config.json — zai-sandbox-glm/glm-4-plus (openai-chat-completions)`);
console.log(`model endpoint: ${GLM_BASE_URL} (sandbox-provisioned GLM service)`);

let failed = 0;

// ---- run A: direct provider, routed proof ---------------------------------
const sandboxA = mkdtempSync(join(tmpdir(), "w33-seed-a-"));
mkdirSync(join(sandboxA, ".zcode", "v2"), { recursive: true });
console.log(`\n== seeding personal provider (run A, direct endpoint) ==`);
if ((await seed(sandboxA, GLM_BASE_URL)) !== 0) {
  console.error("seed A failed");
  process.exit(1);
}
console.log(`\n== run A: full mission through the real host ==`);
const envA = { ...process.env, ZCODE_DATA_BASE_DIR: sandboxA };
const codeA = await run(process.execPath, [join(here, "w3-3-real-host-run.mjs"), "--label", "A"], { env: envA });
if (codeA !== 0) failed += 1;
try {
  const persisted = JSON.parse(readFileSync(join(sandboxA, ".zcode", "v2", "provider_config.json"), "utf8"));
  console.log(`provider_config.json (run A sandbox) schemaVersion=${persisted.schemaVersion}, provider rules=${persisted.config.providerConfigRules.length}`);
} catch {
  console.log("provider_config.json not readable");
}

// ---- run B: deterministic sampling failure, explicit fallback proof --------
console.log(`\n== starting deterministic sampling-kill proxy on :${PROXY_PORT} ==`);
const proxy = spawn(process.execPath, [join(here, "w3-3-sampling-kill-proxy.mjs"), "--port", String(PROXY_PORT)], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (!(await waitServer(PROXY_PORT))) {
  console.error("proxy did not start");
  proxy.kill("SIGTERM");
  process.exit(1);
}
const sandboxB = mkdtempSync(join(tmpdir(), "w33-seed-b-"));
mkdirSync(join(sandboxB, ".zcode", "v2"), { recursive: true });
console.log(`\n== seeding personal provider (run B, kill-proxy endpoint) ==`);
if ((await seed(sandboxB, `http://127.0.0.1:${PROXY_PORT}/v1`)) !== 0) {
  console.error("seed B failed");
  proxy.kill("SIGTERM");
  process.exit(1);
}
console.log(`\n== run B: same mission; sampling requests deterministically rejected (401, non-retryable) ==`);
const envB = { ...process.env, ZCODE_DATA_BASE_DIR: sandboxB };
const codeB = await run(process.execPath, [join(here, "w3-3-real-host-run.mjs"), "--label", "B", "--proxy-port", String(PROXY_PORT)], { env: envB });
if (codeB !== 0) failed += 1;
proxy.kill("SIGTERM");

console.log(`\n== W3-3 result: ${failed === 0 ? "ALL GATES PASSED" : `${failed} run(s) FAILED`} ==`);
process.exit(failed === 0 ? 0 : 1);
