/**
 * Marketing workspace panel — the branded research experience (W3-4, review
 * Priority 3 in the TL progress review; roadmap: "evidence viewer → branded
 * research experience, the opening move of the W4–W6 product build-out").
 *
 * Architecture (follows the office-plugin ui.surfaces pattern exactly):
 *  - this page is served by the marketing MCP server as `ui://marketing/panel.html`
 *    and embedded by the ZCode host surface runtime;
 *  - it connects with the MCP Apps client (`@modelcontextprotocol/ext-apps`,
 *    PostMessageTransport) and talks to the SAME marketing tools the agent uses
 *    (`callServerTool`) — no side channel, no parallel API, no data the tools
 *    do not already return through their zod output schemas;
 *  - honesty rules of docs/marketing/ are preserved verbatim in the UI: coverage
 *    gaps render as gaps, proxy signals keep their [PROXY] labels, demo mode is
 *    badged, and every evidence row shows its provenance.
 *
 * Modules: types.ts (shapes + i18n), state.ts (shared state + escapers),
 * render.ts (templates + wiring), this file (host connection, data fetch,
 * actions, boot). No React — the whole experience is one esbuild IIFE bundle
 * inlined into a single panel.html resource.
 */
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { en, zh, type ConnectionView, type CreativeState, type Evidence, type LoopState, type MissionEntry, type Report } from "./types.ts";
import { S, esc, setHtml } from "./state.ts";
import { render, setActions } from "./render.ts";
import { setCreativeActions } from "./creative.ts";
import { setLoopActions } from "./loop.ts";

const SERVER_NAME = "marketing";
const PLUGIN_VERSION = "0.4.0";

// ---------------------------------------------------------------------------
// Host connection — one App per page, connected before first render.
// ---------------------------------------------------------------------------
const app = new App(
  { name: SERVER_NAME, version: PLUGIN_VERSION },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: false },
);
let connected: Promise<void> | undefined;
const ready = () =>
  (connected ??= app.connect(new PostMessageTransport(window.parent, window.parent)).then(() => undefined));

class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  await ready();
  const result = await app.callServerTool({ name, arguments: args });
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  const error = structured?.error as { message?: string; code?: string } | undefined;
  if (result.isError || error) {
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new ToolError(error?.code ?? "marketing_failure", error?.message ?? text ?? `${name} failed`);
  }
  return structured as T;
}

// ---------------------------------------------------------------------------
// Selection persistence — keyed by the host surface stateKey when provided
// (office-panel convention) so parallel surfaces keep independent selections.
// ---------------------------------------------------------------------------
const storeKey = () => {
  const surface = app.getHostCapabilities()?.experimental?.["zcode/surface"] as
    | { stateKey?: string }
    | undefined;
  return `marketing-panel:${surface?.stateKey ?? "default"}`;
};
const rememberSelection = () => {
  try {
    localStorage.setItem(storeKey(), S.selectedId ?? "");
  } catch {
    /* storage unavailable — selection just resets */
  }
};
const recallSelection = () => {
  try {
    const saved = localStorage.getItem(storeKey());
    if (saved && S.missions.some((m) => m.missionId === saved)) S.selectedId = saved;
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------------------
// Data fetch + action implementations (render.ts wires these into the DOM).
// ---------------------------------------------------------------------------
const failureNotice = (error: unknown) => ({
  kind: "error" as const,
  html: `<b>${esc(S.strings.error)}:</b> ${esc(error instanceof Error ? error.message : String(error))}`,
});

async function refreshAll(): Promise<void> {
  S.loading = true;
  render();
  try {
    const { missions: list } = await callTool<{ missions: MissionEntry[] }>("marketing_mission_list");
    S.missions = list;
    if (!S.selectedId || !S.missions.some((m) => m.missionId === S.selectedId)) {
      S.selectedId = S.missions[0]?.missionId ?? null;
      recallSelection();
    }
    rememberSelection();
    if (S.selectedId) {
      await Promise.all([loadReport(S.selectedId), loadEvidence(S.selectedId), loadCreative(S.selectedId), loadLoop()]);
    }
  } catch (error) {
    S.notice = failureNotice(error);
  } finally {
    S.loading = false;
    render();
  }
}

async function loadReport(missionId: string): Promise<void> {
  try {
    S.report = await callTool<Report>("marketing_mission_report", { missionId });
  } catch (error) {
    S.report = null;
    S.notice = failureNotice(error);
  }
}

async function loadEvidence(missionId: string): Promise<void> {
  try {
    S.evidence = await callTool<Evidence>("marketing_evidence_view", { missionId });
  } catch {
    S.evidence = null;
  }
}

async function loadCreative(missionId: string): Promise<void> {
  try {
    S.creative = await callTool<CreativeState>("marketing_list_artifacts", { missionId });
  } catch {
    S.creative = null;
  }
}

async function loadLoop(): Promise<void> {
  try {
    S.connections = await callTool<{ connections: ConnectionView[] }>("marketing_list_connections").then((r) => r.connections);
  } catch {
    S.connections = [];
  }
  if (!S.selectedId) {
    S.loop = null;
    return;
  }
  try {
    S.loop = await callTool<LoopState>("marketing_list_publications", { missionId: S.selectedId });
  } catch {
    S.loop = null;
  }
}

async function startNewMissionFlow(): Promise<void> {
  S.selectedId = null;
  S.report = null;
  S.evidence = null;
  S.notice = null;
  render();
}

async function submitStart(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  S.creating = true;
  render();
  try {
    const result = await callTool<{ missionId: string }>("marketing_mission_start", {
      product: String(data.get("product") ?? ""),
      audience: String(data.get("audience") ?? ""),
      country: String(data.get("country") ?? "").toUpperCase(),
      platform: String(data.get("platform") ?? "youtube"),
      offer: String(data.get("offer") ?? ""),
      objective: String(data.get("objective") ?? "awareness"),
      researchMode: String(data.get("researchMode") ?? "live"),
      ...(String(data.get("landingUrl") ?? "").trim() ? { landingUrl: String(data.get("landingUrl")).trim() } : {}),
    });
    S.selectedId = result.missionId;
    rememberSelection();
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.notice = failureNotice(error);
    S.creating = false;
    render();
  }
}

async function submitDiscover(form: HTMLFormElement, confirmNames?: string[]): Promise<void> {
  if (!S.selectedId) return;
  const hints =
    confirmNames ??
    String(new FormData(form).get("hints") ?? "")
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (hints.length === 0) return;
  S.discoverBusy = true;
  render();
  try {
    await callTool("marketing_discover_competitors", {
      missionId: S.selectedId,
      hints: hints.slice(0, 8),
      ...(confirmNames ? { confirm: confirmNames } : {}),
    });
    S.discoverBusy = false;
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.discoverBusy = false;
    S.notice = failureNotice(error);
    render();
  }
}

function runResearch(): void {
  if (!S.selectedId) return;
  S.researchBusy = true;
  render();
  void callTool("marketing_research_platform", { missionId: S.selectedId })
    .then(() => {
      S.researchBusy = false;
      S.notice = null;
      return refreshAll();
    })
    .catch((error: unknown) => {
      S.researchBusy = false;
      S.notice = failureNotice(error);
      render();
    });
}

function selectMission(missionId: string): void {
  S.selectedId = missionId;
  S.tab = "report";
  S.report = null;
  S.evidence = null;
  S.creative = null;
  S.notice = null;
  rememberSelection();
  void refreshAll();
}

function selectTab(tab: "report" | "evidence" | "creative" | "loop"): void {
  S.tab = tab;
  render();
}

// ---------------------------------------------------------------------------
// W4 creative actions (wired by ui/creative.ts)
// ---------------------------------------------------------------------------
async function draftForHypothesis(hypothesisId: string): Promise<void> {
  if (!S.selectedId) return;
  S.draftBusy = true;
  render();
  try {
    await callTool("marketing_draft_creative", { missionId: S.selectedId, hypothesisId });
    S.draftBusy = false;
    S.notice = null;
    S.tab = "creative";
    await refreshAll();
  } catch (error) {
    S.draftBusy = false;
    S.notice = failureNotice(error);
    render();
  }
}

async function reviewArtifact(artifactId: string, decision: "approve" | "reject"): Promise<void> {
  if (!S.selectedId) return;
  const reviewedBy =
    (S.creative?.artifacts.find((a) => a.id === artifactId)?.brief.review?.reviewedBy ?? undefined) ??
    (S.locale === "zh" ? "面板用户" : "panel user");
  S.reviewBusy = artifactId;
  render();
  try {
    await callTool("marketing_review_artifact", {
      missionId: S.selectedId,
      artifactId,
      decision,
      reviewedBy,
    });
    S.reviewBusy = "";
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.reviewBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function recordProducedAsset(form: HTMLFormElement): Promise<void> {
  if (!S.selectedId) return;
  const data = new FormData(form);
  const file = data.get("file");
  S.recordBusy = true;
  render();
  try {
    // Chunked import first (office begin/write/finish convention): the mission
    // ends up holding the actual produced file, not just a declaration.
    let importedAssetId: string | undefined;
    if (file instanceof File && file.size > 0) {
      const { id } = await callTool<{ id: string }>("marketing_asset_import_begin", {
        missionId: S.selectedId,
        name: file.name,
        size: file.size,
      });
      const CHUNK = 512 * 1024;
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(slice);
        });
        await callTool("marketing_asset_import_write", { id, offset, data: base64 });
      }
      await callTool("marketing_asset_import_finish", { id });
      importedAssetId = id;
    }
    await callTool("marketing_record_asset", {
      missionId: S.selectedId,
      artifactId: String(data.get("artifactId") ?? ""),
      ...(importedAssetId ? { importedAssetId } : {}),
      format: String(data.get("format") ?? "video"),
      ...(String(data.get("durationSec") ?? "") ? { durationSec: Number(data.get("durationSec")) } : {}),
      aspectRatio: String(data.get("aspectRatio") ?? ""),
      hookText: String(data.get("hookText") ?? ""),
      proofText: String(data.get("proofText") ?? ""),
      ctaText: String(data.get("ctaText") ?? ""),
      transcriptOrCopy: String(data.get("transcriptOrCopy") ?? ""),
    });
    S.recordBusy = false;
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.recordBusy = false;
    S.notice = failureNotice(error);
    render();
  }
}

setActions({ refreshAll, startNewMissionFlow, submitStart, submitDiscover, runResearch, selectMission, selectTab });
setCreativeActions({ draftForHypothesis, reviewArtifact, recordProducedAsset });

// ---------------------------------------------------------------------------
// W5/W6 loop actions (wired by ui/loop.ts) — every action calls the SAME
// marketing tools the agent uses and refreshes through the same pipeline.
// ---------------------------------------------------------------------------
async function connectAccount(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  S.connectBusy = true;
  render();
  try {
    await callTool("marketing_connect_publish_account", {
      platform: String(data.get("platform") ?? "youtube"),
      label: String(data.get("label") ?? ""),
      accessToken: String(data.get("accessToken") ?? ""),
      dataBase: String(data.get("dataBase") ?? "https://www.googleapis.com"),
      accountRef: String(data.get("accountRef") ?? ""),
      environment: String(data.get("environment") ?? "sandbox"),
      connectedBy: S.locale === "zh" ? "面板用户" : "panel user",
    });
    S.connectBusy = false;
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.connectBusy = false;
    S.notice = failureNotice(error);
    render();
  }
}

async function publishAsset(artifactId: string): Promise<void> {
  if (!S.selectedId) return;
  S.publishBusy = artifactId;
  render();
  try {
    await callTool("marketing_publish_asset", {
      missionId: S.selectedId,
      artifactId,
      approvedBy: S.locale === "zh" ? "面板用户" : "panel user",
    });
    S.publishBusy = "";
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.publishBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function assistedHandoff(artifactId: string): Promise<void> {
  if (!S.selectedId) return;
  S.publishBusy = artifactId;
  render();
  try {
    const result = await callTool<{ package: { title: string; description: string; tags: string[]; file?: { name: string; bytes: number; path: string }; steps: string[] } }>(
      "marketing_assisted_handoff",
      { missionId: S.selectedId, artifactId },
    );
    S.publishBusy = "";
    const pkg = result.package;
    const lines = [
      `<b>${esc(pkg.title)}</b>`,
      ...pkg.tags.map((t) => `#${esc(t)}`),
      "",
      pkg.file ? `${esc(pkg.file.name)} (${pkg.file.bytes} B) → ${esc(pkg.file.path)}` : "",
      "",
      ...pkg.steps.map((s, i) => `${i + 1}. ${esc(s)}`),
    ].filter(Boolean);
    S.notice = { kind: "info", html: `<b>${esc(S.locale === "zh" ? "辅助发布包" : "Assisted publishing package")}:</b><br/>${lines.join("<br/>")}` };
    render();
  } catch (error) {
    S.publishBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function recordManualPublication(form: HTMLFormElement): Promise<void> {
  if (!S.selectedId) return;
  const data = new FormData(form);
  S.publishBusy = String(data.get("artifactId") ?? "");
  render();
  try {
    await callTool("marketing_record_manual_publication", {
      missionId: S.selectedId,
      artifactId: String(data.get("artifactId") ?? ""),
      url: String(data.get("url") ?? ""),
      publishedBy: S.locale === "zh" ? "面板用户" : "panel user",
    });
    S.publishBusy = "";
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.publishBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function verifyPublication(publicationId: string): Promise<void> {
  if (!S.selectedId) return;
  S.measureBusy = publicationId;
  render();
  try {
    await callTool("marketing_verify_publication", { missionId: S.selectedId, publicationId });
    S.measureBusy = "";
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.measureBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function openExperiment(publicationId: string): Promise<void> {
  if (!S.selectedId) return;
  S.measureBusy = publicationId;
  render();
  try {
    await callTool("marketing_open_experiment", { missionId: S.selectedId, publicationId });
    S.measureBusy = "";
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.measureBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function collectAnalytics(publicationId: string): Promise<void> {
  if (!S.selectedId) return;
  S.measureBusy = publicationId;
  render();
  try {
    const result = await callTool<{ latest: Array<{ metricKey: string; value: number }> }>(
      "marketing_collect_analytics",
      { missionId: S.selectedId, publicationId, metrics: ["views"] },
    );
    S.measureBusy = "";
    S.notice = {
      kind: "info",
      html: `<b>${esc(S.locale === "zh" ? "已采集许可分析" : "Permitted analytics collected")}:</b> ${result.latest
        .map((l) => `${esc(l.metricKey)} = ${l.value}`)
        .join(" · ")}`,
    };
    await refreshAll();
  } catch (error) {
    S.measureBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

async function recordOutcome(form: HTMLFormElement): Promise<void> {
  if (!S.selectedId) return;
  const data = new FormData(form);
  const experimentId = String(data.get("experimentId") ?? form.dataset.experiment ?? "");
  const observedMetricKey = String(data.get("observedMetricKey") ?? "");
  const proxyLow = String(data.get("proxyLow") ?? "");
  const proxyExpected = String(data.get("proxyExpected") ?? "");
  const proxyHigh = String(data.get("proxyHigh") ?? "");
  const hasProxyBaseline = proxyLow !== "" && proxyExpected !== "" && proxyHigh !== "";
  const goalMetricKey = S.loop?.experiments.find((e) => e.id === experimentId)?.goalMetricKey ?? "";
  const isProxy = observedMetricKey !== "" && observedMetricKey !== goalMetricKey;
  S.outcomeBusy = experimentId;
  render();
  try {
    await callTool("marketing_record_outcome", {
      missionId: S.selectedId,
      experimentId,
      observedValue: Number(data.get("observedValue")),
      ...(isProxy ? { observedMetricKey } : {}),
      ...(isProxy && hasProxyBaseline
        ? { proxyForecast: { low: Number(proxyLow), expected: Number(proxyExpected), high: Number(proxyHigh) } }
        : {}),
      ...(String(data.get("sourceNote") ?? "") ? { sourceNote: String(data.get("sourceNote")) } : {}),
    });
    S.outcomeBusy = "";
    S.notice = null;
    await refreshAll();
  } catch (error) {
    S.outcomeBusy = "";
    S.notice = failureNotice(error);
    render();
  }
}

setLoopActions({
  connectAccount,
  publishAsset,
  assistedHandoff,
  recordManualPublication,
  verifyPublication,
  openExperiment,
  collectAnalytics,
  recordOutcome,
});

// ---------------------------------------------------------------------------
// Boot — connect, adopt the host theme + locale, first paint, then follow the
// agent: every tool result the host forwards our way triggers a debounced
// refresh so the panel reflects the mission as the agent advances it.
// ---------------------------------------------------------------------------
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleRefresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshAll(), 250);
};

/** Theme + style variables from the host context (office-panel convention). */
const adoptHostTheme = (): void => {
  const context = app.getHostContext() as
    | { theme?: string; styles?: { variables?: Record<string, string> } }
    | undefined;
  if (context?.theme === "dark" || context?.theme === "light") applyDocumentTheme(context.theme);
  const variables = context?.styles?.variables;
  if (variables) applyHostStyleVariables(variables);
};

(async () => {
  try {
    await ready();
    adoptHostTheme();
    const context = app.getHostContext();
    const hostLocale = (context as { locale?: string } | undefined)?.locale;
    if (typeof hostLocale === "string" && hostLocale.toLowerCase().startsWith("zh")) {
      S.locale = "zh";
      S.strings = zh;
    }
    app.onhostcontextchanged = () => {
      adoptHostTheme();
      const next = (app.getHostContext() as { locale?: string } | undefined)?.locale;
      const nextLocale = typeof next === "string" && next.toLowerCase().startsWith("zh") ? "zh" : "en";
      if (nextLocale !== S.locale) {
        S.locale = nextLocale;
        S.strings = nextLocale === "zh" ? zh : en;
        render();
      }
    };
    app.ontoolresult = () => scheduleRefresh();
    document.title = S.strings.brand;
  } catch (error) {
    setHtml(
      `<div class="error-state"><div class="notice error"><b>${esc(S.strings.error)}:</b> ${esc(error instanceof Error ? error.message : String(error))}</div></div>`,
    );
    return;
  }
  await refreshAll();
})().catch((error: unknown) => {
  document.getElementById("root")!.textContent = `marketing panel failed: ${error instanceof Error ? error.message : String(error)}`;
});
