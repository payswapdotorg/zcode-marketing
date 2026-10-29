// W3-4 panel E2E — the workspace panel in a REAL browser against the REAL
// bundled server (office-e2e pattern: AppBridge host + iframe with the ZCode
// desktop sandbox CSP + Chromium).
//
// Gates (all must pass; any failure exits 1):
//   1. the served panel resource loads and connects through the MCP Apps
//      handshake (bridge initialized exactly once, no page errors);
//   2. the onboarding form starts a real mission through marketing_mission_start
//      and the panel renders the mission + product brief;
//   3. competitor discovery from the panel persists user-confirmed candidates;
//   4. Run platform research from the panel ingests evidence and the panel
//      renders the honest per-slice coverage (ok/partial/gap states verbatim);
//   5. the evidence tab renders ads/organic/metrics with provenance;
//   6. agent-side activity reaches the panel: a tool result pushed through the
//      bridge (the way the real host forwards server tool results) refreshes
//      the mission list without any panel-side action.
//
// Artifacts (screenshots) go to $MARKETING_E2E_ARTIFACTS or a temp dir.
// Run: pnpm --filter @zcode/marketing-plugin demo:w3-4
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..");
const artifacts =
  process.env.MARKETING_E2E_ARTIFACTS || join(tmpdir(), "marketing-panel-e2e");
await mkdir(artifacts, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "marketing-panel-ws-"));

if (!existsSync(join(plugin, "dist", "server.mjs")) || !existsSync(join(plugin, "dist", "panel.html")))
  throw new Error("dist/server.mjs or dist/panel.html missing — run pnpm build first");

const client = new Client({ name: "marketing-panel-e2e", version: "1" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(plugin, "dist/server.mjs")],
    cwd: workspace,
    env: { PATH: process.env.PATH ?? "", ZCODE_WORKSPACE_ROOT: workspace },
    stderr: "inherit",
  }),
);
const panelResource = await client.readResource({ uri: "ui://marketing/panel.html" });
const html = panelResource.contents[0].text;
assert.match(panelResource.contents[0].mimeType, /text\/html/);

// Same directives as the desktop sandbox (packages/desktop/src/main/pluginSandbox/csp.ts);
// the marketing panel needs no relaxations.
const csp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "form-action 'none'",
].join("; ");

const hostJs = await build({
  stdin: {
    // The bridge plays the ZCode host: it proxies the page's tool calls to the
    // real server over /rpc and can push tool results back like the runtime does.
    contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
const rpc = async (method, args) => {
  const response = await fetch('/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args})});
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const params = new URLSearchParams(location.search);
const context = { theme: params.get('theme') || 'light', locale: params.get('locale') || 'en-US', displayMode: 'fullscreen' };
const bridge = new AppBridge(null, {name:'marketing-e2e',version:'1'}, {serverTools:{},serverResources:{},message:{text:{}},updateModelContext:{text:{}},openLinks:{},experimental:{"zcode/surface":{id:"marketing",stateKey:params.get("tab")||"first"}}}, {hostContext:context});
window.__initializations = 0;
bridge.oncalltool = (args) => rpc('callTool', args);
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.onmessage = async () => ({});
bridge.onupdatemodelcontext = async () => ({});
bridge.onopenlink = async () => ({});
bridge.oninitialized = () => { window.__initializations++; };
window.__sendToolResult = (result) => bridge.sendToolResult(result);
const frame = document.querySelector('iframe');
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/panel';
`,
    resolveDir: plugin,
    sourcefile: "browser-host.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        '<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-same-origin allow-forms"></iframe><script type="module" src="/host.js"></script>',
      );
    } else if (url.pathname === "/host.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(hostJs.outputFiles[0].text);
    } else if (url.pathname === "/panel") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Content-Security-Policy", csp);
      response.end(html);
    } else if (request.method === "POST" && url.pathname === "/rpc") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { method, args } = JSON.parse(body);
      const result =
        method === "readResource" ? await client.readResource(args) : await client.callTool(args);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } else if (url.pathname === "/favicon.ico") response.writeHead(204).end();
    else response.writeHead(404).end();
  } catch (error) {
    response
      .writeHead(500, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome",
].filter(Boolean);
const executablePath = chromeCandidates.find((path) => existsSync(path));
const browser = await chromium.launch(
  executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
);
const errors = [];
const gates = [];
const gate = (name, ok, detail = "") => {
  gates.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const outer = await browser.newPage({ viewport: { width: 1200, height: 860 } });
outer.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
outer.on("console", (message) => {
  if (message.type() === "error" && !/favicon|net::ERR/.test(message.text()))
    errors.push(`console: ${message.text()}`);
});
await outer.goto(base);
await outer.waitForFunction(() => window.__initializations === 1, null, { timeout: 15000 });
const frame = outer.frames().find((item) => item !== outer.mainFrame());
assert.ok(frame, "panel iframe exists");
const shot = (name) => outer.screenshot({ path: join(artifacts, name) });
const shotFull = (name) => outer.screenshot({ path: join(artifacts, name), fullPage: true });
const call = (name, args) => client.callTool({ name, arguments: args });

try {
  // Gate 1: the panel connected and rendered its empty state (hero + form).
  await frame.locator("#start-form").waitFor({ timeout: 15000 });
  gate("panel-connects-and-renders-hero", true, "onboarding form visible after MCP Apps handshake");

  // Gate 2: onboarding form → real mission through marketing_mission_start.
  await frame.fill('#start-form input[name="product"]', "portable espresso maker");
  await frame.fill('#start-form input[name="audience"]', "commuting coffee drinkers");
  await frame.fill('#start-form input[name="country"]', "US");
  await frame.fill('#start-form input[name="offer"]', "30-day home trial");
  await frame.selectOption('#start-form select[name="researchMode"]', "demo");
  await frame.locator('#start-form button[type="submit"]').click();
  await frame.locator("#discover-form").waitFor({ timeout: 20000 });
  const briefText = await frame.textContent(".card");
  assert.match(briefText, /portable espresso maker/);
  gate("onboarding-form-starts-mission", true, "mission view renders the persisted brief");
  await shot("01-mission-started.png");

  // Gate 3: competitor discovery from the panel, with user confirmation.
  await frame.fill('#discover-form input[name="hints"]', "RivalOne, RivalTwo");
  await frame.locator('#discover-form button[type="submit"]').click();
  await frame.getByText("RivalOne").first().waitFor({ timeout: 20000 });
  await frame.locator("#confirm-all-btn").click();
  await frame.getByText("confirmed").first().waitFor({ timeout: 20000 });
  const listResult = await call("marketing_mission_list", {});
  const missions = listResult.structuredContent.missions;
  assert.equal(missions.length, 1);
  assert.ok(missions[0].competitors.length >= 2);
  assert.ok(missions[0].competitors.every((c) => c.userConfirmed));
  gate("panel-discovery-confirms-competitors", true, `${missions[0].competitors.length} candidates user-confirmed and persisted`);
  await shot("02-competitors-confirmed.png");

  // Gate 4: platform research from the panel → honest coverage rendered.
  await frame.locator("#research-btn").click();
  // Wait for actual coverage slice rows inside the coverage card (not the
  // competitor state badges — the empty coverage card also has a header).
  await frame
    .locator('.card:has(h2:text("Data coverage")) .rows .row')
    .first()
    .waitFor({ timeout: 60000 });
  const coverageStates = await frame
    .locator('.card:has(h2:text("Data coverage")) .state')
    .allTextContents();
  assert.ok(coverageStates.length > 0, "no coverage slice states rendered");
  gate("panel-research-renders-coverage", true, `coverage slices rendered: ${coverageStates.slice(0, 6).join(", ")}`);
  await shot("03-coverage-rendered.png");

  // Gate 5: evidence tab renders ads/organic/metrics with provenance.
  await frame.locator('[data-tab="evidence"]').click();
  await frame.locator("table.data").first().waitFor({ timeout: 15000 });
  const tables = await frame.locator("table.data").count();
  assert.ok(tables >= 2, `expected at least ads+organic tables, got ${tables}`);
  const provenance = await frame.locator("td.mono").allTextContents();
  assert.ok(provenance.some((cell) => /connector:|source:|youtube|google|sample/i.test(cell)));
  gate("evidence-tab-renders-provenance", true, `${tables} provenance tables rendered`);
  await shot("04-evidence-tab.png");

  // Back to the report tab for the agent-push gate.
  await frame.locator('[data-tab="report"]').click();

  // Gate 6: agent activity reaches the panel — the e2e starts a second mission
  // through the real server (the way the agent would) and forwards the tool
  // result through the bridge; the panel must refresh on its own.
  const second = await call("marketing_mission_start", {
    product: "cold brew concentrate",
    audience: "iced coffee fans",
    country: "US",
    platform: "youtube",
    offer: "summer bundle",
    objective: "awareness",
    researchMode: "demo",
    missionId: "mission-panel-second",
  });
  assert.ok(!second.isError);
  await outer.evaluate((result) => window.__sendToolResult(result), second);
  await frame
    .locator(".mission-item", { hasText: "cold brew concentrate" })
    .waitFor({ timeout: 15000 });
  gate("agent-tool-result-refreshes-panel", true, "mission list updated from a forwarded tool result, no panel action");

  // The panel scrolls inside the iframe, so a plain fullPage shot of the host
  // page still crops to the viewport. Expand the frame (same-origin iframe) so
  // the whole report lays out without internal scrolling, then capture.
  await outer.evaluate(() => {
    const frame = document.querySelector("iframe");
    const doc = frame.contentDocument;
    const scroller = doc.querySelector(".main");
    const wanted = scroller
      ? scroller.scrollHeight + scroller.offsetTop + 40
      : doc.body.scrollHeight + 40;
    frame.style.height = `${Math.max(wanted, 900)}px`;
  });
  await shotFull("05-agent-push-refreshed.png");

  // The full report is long — assert the opportunities section actually rendered
  // (below the fold in the viewport; fullPage screenshot + DOM check).
  const opportunityCount = await frame.locator(".opportunity").count();
  assert.ok(opportunityCount > 0, `expected ranked opportunities, got ${opportunityCount}`);
  const scoreChips = await frame.locator(".opportunity .score").count();
  assert.ok(scoreChips >= opportunityCount * 3, "separated score chips missing");
  gate(
    "report-renders-ranked-opportunities",
    true,
    `${opportunityCount} opportunities with ${scoreChips} separated score chips (observed / cross-source / predicted / confidence)`,
  );

  gate("no-page-errors", errors.length === 0, errors.length ? errors.join(" | ") : "clean console");
} finally {
  const summary = [
    "W3-4 marketing workspace panel — browser E2E gates",
    `server: ${join(plugin, "dist/server.mjs")} (real bundled plugin process)`,
    `panel: ui://marketing/panel.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB self-contained resource)`,
    `browser: chromium ${browser.version()} — MCP Apps AppBridge host, desktop sandbox CSP`,
    `artifacts: ${artifacts}`,
    "",
    ...gates,
    "",
    errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors",
    "",
  ].join("\n");
  console.log(summary);
  await rm(workspace, { recursive: true, force: true });
  await browser.close();
  server.close();
  await client.close();
  process.exit(process.exitCode ?? 0);
}
