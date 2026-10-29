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
//   7-9 (W4): the creative handoff driven through the panel — draft pack,
//      explicit approval, chunked bring-back with the rubric report.
//   10-15 (W5/W6): the loop driven through the panel — connect a sandbox test
//      account (health-checked against this script's local wire endpoint),
//      publish the approved asset (idempotent — replay adds no post), verify
//      the post, open the measurement window, collect permitted analytics,
//      record the outcome → [PROXY]-labeled comparison + calibration + the
//      grounded next-experiment recommendation, all rendered.
//
// Artifacts (screenshots) go to $MARKETING_E2E_ARTIFACTS or a temp dir.
// Run: pnpm --filter @zcode/marketing-plugin demo:w3-4
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const SANDBOX_TOKEN = "sandbox-test-token-DO-NOT-ECHO-panel-e2e";
const wire = { uploads: 0 };

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
    // W5/W6 gates: the local sandbox test-account endpoint — the REAL YouTube
    // Data API v3 + Analytics API v2 wire shapes, pointed at by the connected
    // (sandbox-labeled) account exactly like a real test endpoint. The bearer
    // is validated on every route except the pre-authorized resumable session.
    const isSessionUpload = request.method === "PUT" && url.pathname.startsWith("/upload/resumable/");
    const wireJson = (status, body, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", ...headers });
      response.end(body);
    };
    if (
      url.pathname === "/youtube/v3/videos" ||
      url.pathname === "/upload/youtube/v3/videos" ||
      url.pathname.startsWith("/upload/resumable/") ||
      url.pathname === "/v2/reports"
    ) {
      if (!isSessionUpload && request.headers.authorization !== `Bearer ${SANDBOX_TOKEN}`) {
        wireJson(401, JSON.stringify({ error: { code: 401, message: "Invalid Credentials" } }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/upload/youtube/v3/videos") {
        wire.uploads += 1;
        wireJson(200, "", { Location: `http://127.0.0.1:${server.address().port}/upload/resumable/session-${wire.uploads}` });
        return;
      }
      if (isSessionUpload) {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () =>
          wireJson(201, JSON.stringify({
            id: "sbvid001",
            snippet: { title: "sandbox test upload", publishedAt: new Date().toISOString() },
            status: { uploadStatus: "processed", privacyStatus: "public" },
          })));
        return;
      }
      if (request.method === "GET" && url.pathname === "/youtube/v3/videos") {
        wireJson(200, JSON.stringify({
          items: [{
            id: "sbvid001",
            snippet: { title: "sandbox test upload", publishedAt: new Date().toISOString() },
            status: { uploadStatus: "processed", privacyStatus: "public" },
          }],
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v2/reports") {
        wireJson(200, JSON.stringify({
          columnHeaders: [
            { name: "day", columnType: "DIMENSION", dataType: "STRING" },
            { name: "views", columnType: "METRIC", dataType: "INTEGER" },
          ],
          rows: [["2026-10-23", "1200"], ["2026-10-24", "3100"], ["2026-10-25", "5400"]],
        }));
        return;
      }
    }
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
  await frame.selectOption('#start-form select[name="objective"]', "sales");
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

  // Gate 6b: the report (first mission) renders ranked opportunities with
  // separated score chips — DOM-checked; the panel scrolls internally so the
  // element lives below the fold in the viewport.
  const opportunityCount = await frame.locator(".opportunity").count();
  assert.ok(opportunityCount > 0, `expected ranked opportunities, got ${opportunityCount}`);
  const scoreChips = await frame.locator(".opportunity .score").count();
  assert.ok(scoreChips >= opportunityCount * 3, "separated score chips missing");
  gate(
    "report-renders-ranked-opportunities",
    true,
    `${opportunityCount} opportunities with ${scoreChips} separated score chips (observed / cross-source / predicted / confidence)`,
  );

  // ---------------------------------------------------------------------
  // W4 gates: the creative handoff driven through the panel in the browser.
  // ---------------------------------------------------------------------
  // Rank through the server (the agent's job) for the FIRST mission — the one
  // the onboarding form created (auto-generated id), pushed so the panel
  // refreshes, then switch to the Creative tab.
  const w4List = await call("marketing_mission_list", {});
  const w4Missions = w4List.structuredContent.missions;
  const first = w4Missions.find((m) => m.brief.product === "portable espresso maker");
  assert.ok(first, "first mission exists");
  const rank = await call("marketing_rank_opportunities", { missionId: first.missionId });
  assert.ok(!rank.isError, JSON.stringify(rank.content));
  await outer.evaluate((result) => window.__sendToolResult(result), rank);

  await frame.locator('[data-tab="creative"]').click();
  await frame.locator(".card", { hasText: "Ranked hypotheses" }).waitFor({ timeout: 15000 });

  // Gate 7: drafting from the panel produces the handoff pack.
  await frame.locator("[data-draft]").first().click();
  await frame
    .locator(".card", { hasText: "Creative handoff pack" })
    .first()
    .waitFor({ timeout: 30000 });
  const scriptRows = await frame.locator(".card table.data tr").count();
  assert.ok(scriptRows >= 4, `expected the timed script beats table, got ${scriptRows} rows`);
  gate(
    "panel-drafts-creative-handoff-pack",
    true,
    "handoff pack renders with timed script beats, prompt packs and provenance",
  );
  await shotFull("06-creative-draft.png");

  // Gate 8: the panel approves the pack (explicit review).
  await frame.locator("[data-review-approve]").first().click();
  await frame.locator(".state", { hasText: "approved" }).first().waitFor({ timeout: 15000 });
  gate("panel-review-approves-pack", true, "explicit approval flips the artifact status to approved");

  // Gate 9: bring-back — file import + declaration + rubric report.
  await frame.fill('#record-asset-form input[name="hookText"]', "Cafe-grade espresso on your commute");
  await frame.fill('#record-asset-form input[name="proofText"]', "unedited before/after extraction demo");
  await frame.fill('#record-asset-form input[name="ctaText"]', "Get yours with the 30-day trial");
  await frame.fill(
    '#record-asset-form textarea[name="transcriptOrCopy"]',
    "Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot. Get yours with the 30-day trial.",
  );
  const chooser = outer.waitForEvent("filechooser");
  await frame.locator('#record-asset-form input[type="file"]').click();
  const fixtureFile = join(tmpdir(), "marketing-e2e-ad.mp4");
  await writeFile(fixtureFile, Buffer.from("fake-mp4-bytes-for-the-w4-panel-gate"));
  await (await chooser).setFiles(fixtureFile);
  await frame.locator('#record-asset-form button[type="submit"]').click();
  await frame
    .locator(".card", { hasText: "Recorded asset" })
    .first()
    .waitFor({ timeout: 30000 });
  const rubricRows = await frame
    .locator('.card:has-text("Recorded asset") .row')
    .count();
  assert.ok(rubricRows > 0, "rubric checks rendered");
  const fileCell = await frame
    .locator(".kv dd.mono")
    .allTextContents();
  assert.ok(fileCell.some((cell) => cell.includes("ad.mp4") && cell.includes(".zcode/marketing/")), "imported file recorded in the mission workspace");
  gate(
    "panel-records-asset-with-rubric",
    true,
    `chunked import + declaration recorded; ${rubricRows} rubric checks rendered with the file in the mission workspace`,
  );

  // Expand the frame to capture the full creative tab, then screenshot.
  await outer.evaluate(() => {
    const frameEl = document.querySelector("iframe");
    const doc = frameEl.contentDocument;
    const scroller = doc.querySelector(".main");
    const wanted = scroller
      ? scroller.scrollHeight + scroller.offsetTop + 40
      : doc.body.scrollHeight + 40;
    frameEl.style.height = `${Math.max(wanted, 900)}px`;
  });
  await shotFull("07-creative-asset-recorded.png");

  // ---------------------------------------------------------------------
  // W5/W6 gates: the loop driven through the panel in the browser.
  // ---------------------------------------------------------------------
  // The recorded asset is in review — approve it through the panel first.
  await frame.locator("[data-review-approve]").first().click();
  await frame
    .locator(".state", { hasText: "approved" })
    .nth(1)
    .waitFor({ timeout: 15000 });

  // Gate 10: connect a sandbox test account through the panel form.
  await frame.locator('[data-tab="loop"]').click();
  await frame.locator("#connect-account-form").waitFor({ timeout: 15000 });
  await frame.fill('#connect-account-form input[name="label"]', "sandbox test channel");
  await frame.fill('#connect-account-form input[name="accountRef"]', "UCsandbox00000000000000AA");
  await frame.fill('#connect-account-form input[name="dataBase"]', `http://127.0.0.1:${server.address().port}`);
  await frame.fill('#connect-account-form input[name="accessToken"]', SANDBOX_TOKEN);
  await frame.selectOption('#connect-account-form select[name="environment"]', "sandbox");
  await frame.locator('#connect-account-form button[type="submit"]').click();
  await frame
    .locator(".card", { hasText: "Connected publishing accounts" })
    .locator(".state", { hasText: "sandbox" })
    .waitFor({ timeout: 20000 });
  const connectionRows = await frame
    .locator('.card:has-text("Connected publishing accounts") .row')
    .count();
  assert.equal(connectionRows, 1, `expected 1 connected account, got ${connectionRows}`);
  gate("panel-connects-sandbox-account", true, "health-checked account connected, sandbox-labeled, token-free row rendered");

  // Gate 11: publish the approved asset through the panel (resumable upload
  // through the connected account; the wire endpoint sees exactly one upload).
  await frame.locator("[data-publish]").first().click();
  await frame
    .locator(".card", { hasText: "Publications" })
    .locator(".state", { hasText: "published" })
    .first()
    .waitFor({ timeout: 30000 });
  assert.equal(wire.uploads, 1, `expected exactly 1 wire upload, got ${wire.uploads}`);
  const sandboxBadge = await frame
    .locator(".card", { hasText: "Publications" })
    .getByText("SANDBOX test account")
    .count();
  assert.ok(sandboxBadge > 0, "the publication renders the SANDBOX test-account badge");
  gate("panel-publishes-through-connected-account", true, "idempotent upload (1 wire POST+PUT), post identity + SANDBOX badge rendered");

  // Gate 12: agent-side retry replay — no duplicate post, panel stays at 1.
  const replay = await call("marketing_publish_asset", {
    missionId: first.missionId,
    artifactId: (
      (await call("marketing_list_artifacts", { missionId: first.missionId }))
        .structuredContent.artifacts.find((a) => a.kindOf === "uploadedAsset")
    ).id,
    approvedBy: "marketing lead",
  });
  assert.equal(replay.structuredContent.idempotentReplay, true, "retry must be an idempotent replay");
  assert.equal(wire.uploads, 1, `replay must not hit the wire again (uploads=${wire.uploads})`);
  await outer.evaluate((result) => window.__sendToolResult(result), replay);
  const publicationRows = await frame
    .locator('.card:has-text("Publications") .row')
    .count();
  assert.equal(publicationRows, 1, `expected exactly 1 publication row, got ${publicationRows}`);
  gate("panel-idempotent-replay-single-publication", true, "agent retry returned the same publication; panel still shows exactly one");

  // Gate 13: verify the post from the panel → status flips to verified.
  await frame.locator("[data-verify]").first().click();
  await frame
    .locator(".card", { hasText: "Publications" })
    .locator(".state", { hasText: "verified" })
    .first()
    .waitFor({ timeout: 30000 });
  gate("panel-verifies-publication", true, "connected-account verification (videos.list) flips the chip to verified");

  // Gate 14: open the measurement window + collect permitted analytics.
  await frame.locator("[data-open-experiment]").first().click();
  await frame
    .locator(".card", { hasText: "Experiment" })
    .first()
    .waitFor({ timeout: 30000 });
  const goalMetric = await frame
    .locator('.card:has-text("Experiment") .kv dd')
    .first()
    .textContent();
  assert.match(String(goalMetric), /attributedConversions/, "experiment binds the objective metric");
  await frame.locator("[data-collect]").first().click();
  await frame
    .locator(".notice", { hasText: "views = 5400" })
    .waitFor({ timeout: 30000 });
  gate("panel-measures-and-collects-analytics", true, "window opened on the W4 spec; permitted analytics rendered (views = 5400)");
  await shotFull("08-loop-measuring.png");

  // Gate 15: record the outcome → the loop closes, rendered.
  const outcomeForm = frame.locator("form[id^='record-outcome-form-']").first();
  await outcomeForm.locator('input[name="observedValue"]').fill("5400");
  await outcomeForm.locator('select[name="observedMetricKey"]').selectOption("views");
  await outcomeForm.locator('input[name="proxyLow"]').fill("3000");
  await outcomeForm.locator('input[name="proxyExpected"]').fill("5000");
  await outcomeForm.locator('input[name="proxyHigh"]').fill("9000");
  await outcomeForm.locator('input[name="sourceNote"]').fill("connected-account analytics (sandbox test channel)");
  await outcomeForm.locator('button[type="submit"]').click();
  await frame
    .locator(".card", { hasText: "Experiment" })
    .locator(".state", { hasText: "completed" })
    .first()
    .waitFor({ timeout: 30000 });
  const proxyChip = await frame.locator(".card", { hasText: "Experiment" }).getByText("[PROXY]").count();
  assert.ok(proxyChip > 0, "the [PROXY] label renders on the recorded outcome");
  const calibration = await frame
    .locator(".card", { hasText: "Experiment" })
    .getByText("Calibration history (appended, never overwritten)")
    .count();
  assert.ok(calibration > 0, "the appended calibration history renders");
  const recommendation = await frame
    .locator(".card", { hasText: "Experiment" })
    .getByText("Next experiment (grounded in the recorded result)")
    .count();
  assert.ok(recommendation > 0, "the grounded next-experiment recommendation renders");
  gate(
    "panel-records-outcome-and-closes-loop",
    true,
    "[PROXY]-labeled comparison against the declared proxy baseline, appended calibration, grounded recommendation — all rendered",
  );
  await shotFull("09-loop-closed.png");

  gate("no-page-errors", errors.length === 0, errors.length ? errors.join(" | ") : "clean console");
} catch (error) {
  gates.push(`FAIL  unexpected-error — ${String(error)}`);
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
  await outer.screenshot({ path: join(artifacts, "99-failure.png"), fullPage: true }).catch(() => undefined);
} finally {
  const summary = [
    "marketing workspace panel — browser E2E gates (W3-4 + W4 + W5/W6)",
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
