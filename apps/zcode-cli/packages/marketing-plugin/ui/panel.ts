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
import { en, zh, type Evidence, type MissionEntry, type Report } from "./types.ts";
import { S, esc, setHtml } from "./state.ts";
import { render, setActions } from "./render.ts";

const SERVER_NAME = "marketing";
const PLUGIN_VERSION = "0.3.0";

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
      await Promise.all([loadReport(S.selectedId), loadEvidence(S.selectedId)]);
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
  S.notice = null;
  rememberSelection();
  void refreshAll();
}

function selectTab(tab: "report" | "evidence"): void {
  S.tab = tab;
  render();
}

setActions({ refreshAll, startNewMissionFlow, submitStart, submitDiscover, runResearch, selectMission, selectTab });

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
