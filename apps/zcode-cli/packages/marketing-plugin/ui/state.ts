/**
 * Marketing workspace panel — shared mutable state + tiny DOM/escaping helpers
 * (W3-4). One state object the render module reads and the app module writes;
 * plain modules instead of a framework, per the office-panel "no React for
 * simple surfaces" decision recorded in docs/plugins/.
 */
import { en, type Brief, type Evidence, type MissionEntry, type Report, type Strings } from "./types.ts";

export interface PanelNotice {
  kind: "info" | "warn" | "error";
  html: string;
}

export const S = {
  locale: "en" as "en" | "zh",
  strings: en as Strings,
  missions: [] as MissionEntry[],
  selectedId: null as string | null,
  tab: "report" as "report" | "evidence",
  report: null as Report | null,
  evidence: null as Evidence | null,
  loading: false,
  notice: null as PanelNotice | null,
  discoverBusy: false,
  researchBusy: false,
  creating: false,
};

/** Current mission entry according to selection (falls back to the first). */
export const selectedMission = (): MissionEntry | undefined =>
  S.missions.find((m) => m.missionId === S.selectedId);

/** The brief shown in the report view: server report first, index entry second. */
export const selectedBrief = (): Brief | undefined =>
  (S.selectedId && S.report?.missionId === S.selectedId ? S.report.brief : undefined) ??
  selectedMission()?.brief;

// ---------------------------------------------------------------------------
// DOM helpers — every dynamic value goes through esc(); the panel renders only
// server-validated payloads, but escaping stays mandatory (no innerHTML sinks
// with raw data).
// ---------------------------------------------------------------------------
export const esc = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  );

export const num = (value: number | undefined, digits = 1): string =>
  value === undefined || Number.isNaN(value) ? S.strings.missing : value.toFixed(digits);

export const setHtml = (html: string): void => {
  document.getElementById("root")!.innerHTML = html;
};

export const STATE_CLASS: Record<string, string> = {
  ok: "ok",
  partial: "partial",
  gap: "gap",
};
