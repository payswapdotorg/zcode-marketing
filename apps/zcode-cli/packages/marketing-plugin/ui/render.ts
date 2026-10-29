/**
 * Marketing workspace panel — renderers + event wiring (W3-4).
 *
 * Pure template-string rendering over the shared panel state (ui/state.ts):
 * honesty rules of docs/marketing/ are preserved verbatim in the UI — coverage
 * gaps render as gaps, proxy signals keep their [PROXY] notes, demo mode is
 * badged, every evidence row shows provenance. Actions are injected by the app
 * module (ui/panel.ts) so this file stays free of host-connection concerns.
 */
import { OBJECTIVES, type MissionEntry } from "./types.ts";
import { S, STATE_CLASS, esc, num, selectedBrief, selectedMission, setHtml } from "./state.ts";
import { renderCreative, wireCreative } from "./creative.ts";
import { renderLoop, wireLoop } from "./loop.ts";

/** Actions the app module provides; wired into rendered controls. */
export interface PanelActions {
  refreshAll: () => Promise<void>;
  startNewMissionFlow: () => Promise<void>;
  submitStart: (form: HTMLFormElement) => Promise<void>;
  submitDiscover: (form: HTMLFormElement, confirmNames?: string[]) => Promise<void>;
  runResearch: () => void;
  selectMission: (missionId: string) => void;
  selectTab: (tab: "report" | "evidence" | "creative" | "loop") => void;
}

let actions: PanelActions;

/** Called once by the app module before the first render. */
export const setActions = (value: PanelActions): void => {
  actions = value;
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------
export function render(): void {
  if (S.loading && S.missions.length === 0 && !S.notice) {
    setHtml(`<div class="loading"><div class="spin"></div>${esc(S.strings.loading)}</div>`);
    return;
  }
  const main = S.selectedId || S.missions.length > 0 ? renderMission() : renderHero();
  setHtml(`
    <div class="layout">
      ${renderSidebar()}
      <div class="main">${S.notice ? `<div class="notice ${S.notice.kind}">${S.notice.html}</div>` : ""}${main}</div>
    </div>`);
  wire();
}

function renderSidebar(): string {
  const items = S.missions
    .map((m) => {
      const active = m.missionId === S.selectedId;
      return `
      <button class="mission-item${active ? " active" : ""}" data-mission="${esc(m.missionId)}">
        <span class="name"><span class="title-text">${esc(m.brief.product)}</span>
          <span class="mode-chip ${m.researchMode}">${esc(m.researchMode)}</span></span>
        <span class="meta">${esc(m.brief.platform)} · ${esc(m.brief.objective)} · ${esc(m.brief.country)} · ${m.competitors.length} ${esc(S.locale === "zh" ? "竞品" : "competitors")}</span>
      </button>`;
    })
    .join("");
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">M</div>
        <div><div class="brand-name">${esc(S.strings.brand)}</div><div class="brand-sub">${esc(S.strings.brandSub)}</div></div>
      </div>
      <div class="new-mission"><button class="primary" id="new-mission-btn" style="width:100%">${esc(S.strings.newMission)}</button></div>
      <div class="mission-list">${items || `<div class="empty" style="padding:8px 10px">${esc(S.strings.emptyMissions)}</div>`}</div>
    </aside>`;
}

function renderHero(): string {
  const objectiveOptions = OBJECTIVES.map(
    (o) => `<option value="${o.value}">${esc(S.locale === "zh" ? o.zh : o.en)}</option>`,
  ).join("");
  return `
    <div class="hero">
      <div class="brand-mark">M</div>
      <h1>${esc(S.strings.heroTitle)}</h1>
      <p>${esc(S.strings.heroBody)}</p>
      <div class="card">
        <h2>${esc(S.strings.startTitle)}</h2>
        <form id="start-form">
          <div class="form-grid">
            <label class="field wide">${esc(S.strings.product)}<input name="product" required maxlength="2000" placeholder="e.g. portable espresso machine"/></label>
            <label class="field">${esc(S.strings.audience)}<input name="audience" required maxlength="2000" placeholder="e.g. outdoor coffee lovers"/></label>
            <label class="field">${esc(S.strings.country)}<input name="country" required maxlength="2" value="US" pattern="[A-Za-z]{2}" style="text-transform:uppercase"/></label>
            <label class="field">${esc(S.strings.platform)}
              <select name="platform"><option value="youtube">youtube</option></select>
              <span class="hint">${esc(S.strings.platformHint)}</span>
            </label>
            <label class="field">${esc(S.strings.offer)}<input name="offer" required maxlength="2000" placeholder="e.g. launch bundle"/></label>
            <label class="field">${esc(S.strings.objective)}<select name="objective">${objectiveOptions}</select></label>
            <label class="field">${esc(S.strings.mode)}
              <select name="researchMode">
                <option value="live">${esc(S.strings.modeLive)}</option>
                <option value="demo">${esc(S.strings.modeDemo)}</option>
              </select>
            </label>
            <label class="field">${esc(S.strings.landingUrl)}<input name="landingUrl" type="url" placeholder="https://…"/></label>
            <label class="field wide"><button class="primary" type="submit" ${S.creating ? "disabled" : ""}>${esc(S.creating ? S.strings.creating : S.strings.create)}</button></label>
          </div>
        </form>
      </div>
    </div>`;
}

function renderMission(): string {
  const entry = selectedMission();
  if (!entry) return `<div class="loading">${esc(S.strings.loading)}</div>`;
  const brief = selectedBrief() ?? entry.brief;
  return `
    <div class="topbar">
      <h1><span class="mode-chip ${entry.researchMode}">${esc(entry.researchMode)}</span><span class="title-text">${esc(brief.product)}</span></h1>
      <div class="toolbar"><button class="ghost" id="refresh-btn">↻ ${esc(S.strings.refresh)}</button></div>
    </div>
    ${entry.researchMode === "demo" ? `<div class="notice warn">${esc(S.strings.demoNotice)}</div>` : `<div class="notice info">${esc(S.strings.liveNotice)}</div>`}
    <div class="tabs">
      <button class="tab${S.tab === "report" ? " active" : ""}" data-tab="report">${esc(S.locale === "zh" ? "调研报告" : "Research report")}</button>
      <button class="tab${S.tab === "evidence" ? " active" : ""}" data-tab="evidence">${esc(S.strings.evidence)}</button>
      <button class="tab${S.tab === "creative" ? " active" : ""}" data-tab="creative">${esc(S.locale === "zh" ? "创意" : "Creative")}</button>
      <button class="tab${S.tab === "loop" ? " active" : ""}" data-tab="loop">${esc(S.locale === "zh" ? "发布与测量" : "Publish & Measure")}</button>
    </div>
    ${S.tab === "report" ? renderReport(entry) : S.tab === "evidence" ? renderEvidence() : S.tab === "creative" ? renderCreative() : renderLoop()}`;
}

function renderReport(entry: MissionEntry): string {
  const brief = selectedBrief() ?? entry.brief;
  const competitors = S.report?.competitors ?? entry.competitors;
  const sections: string[] = [];

  sections.push(`
    <div class="card"><h2>${esc(S.strings.brief)}</h2>
      <dl class="kv">
        <dt>${esc(S.strings.product)}</dt><dd>${esc(brief.product)}</dd>
        <dt>${esc(S.strings.audience)}</dt><dd>${esc(brief.audience)}</dd>
        <dt>${esc(S.strings.offer)}</dt><dd>${esc(brief.offer)}</dd>
        <dt>${esc(S.strings.objective)}</dt><dd>${esc(brief.objective)}</dd>
        <dt>${esc(S.strings.platform)}</dt><dd>${esc(brief.platform)} · ${esc(brief.country)}</dd>
        ${brief.landingUrl ? `<dt>URL</dt><dd>${esc(brief.landingUrl)}</dd>` : ""}
        ${(brief.constraints ?? []).length > 0 ? `<dt>${esc(S.strings.constraintList)}</dt><dd>${(brief.constraints ?? []).map(esc).join(" · ")}</dd>` : ""}
      </dl>
    </div>`);

  const nextStep = !S.report
    ? S.strings.nextResearch
    : competitors.length === 0
      ? S.strings.nextDiscover
      : S.report.opportunities.length === 0
        ? S.strings.nextAnalyze
        : null;

  sections.push(`
    <div class="card"><h2>${esc(S.strings.competitors)} <span class="count">${competitors.length}</span></h2>
      ${competitors.length === 0 ? `<div class="empty">${esc(S.strings.competitorsEmpty)}</div>` : `
      <div class="rows">${competitors
        .map(
          (c) => `
        <div class="row">
          <span class="state ${c.userConfirmed ? "ok" : "partial"}">${c.userConfirmed ? esc(S.strings.confirmed) : esc(S.strings.identity)}</span>
          <div class="grow"><b>${esc(c.displayName)}</b>
            <div class="sub">${esc(c.relevanceReason)}</div></div>
          <span class="score">${esc(S.strings.identity)} ${c.identityConfidence.toFixed(2)}</span>
        </div>`,
        )
        .join("")}</div>`}
      <form id="discover-form" style="margin-top:12px">
        <div class="form-grid">
          <label class="field wide">${esc(S.strings.discoverTitle)}
            <input name="hints" required placeholder="AeroPress, Wacaco, …"/>
            <span class="hint">${esc(S.strings.discoverHint)}</span>
          </label>
          <div><button class="ghost" type="submit" ${S.discoverBusy ? "disabled" : ""}>${esc(S.strings.discover)}</button>
          ${competitors.some((c) => !c.userConfirmed) ? `<button class="ghost" type="button" id="confirm-all-btn" style="margin-left:6px">${esc(S.strings.confirmAll)}</button>` : ""}</div>
        </div>
      </form>
    </div>`);

  if (S.report?.coverage) {
    sections.push(`
    <div class="card"><h2>${esc(S.strings.coverage)}</h2>
      <div class="rows">${S.report.coverage.slices
        .map(
          (s) => `
        <div class="row">
          <span class="state ${STATE_CLASS[s.state] ?? "partial"}">${esc(s.state)}</span>
          <div class="grow"><b>${esc(s.slice)}</b><div class="sub">${esc(s.note)}</div></div>
          <span class="mono">${esc(s.sourceId)} v${esc(s.connectorVersion)}</span>
        </div>`,
        )
        .join("")}</div>
      <p style="margin:10px 0 0;font-size:12.5px"><b>${esc(S.strings.conclusion)}:</b> ${esc(S.report.coverage.supportsConclusion)}</p>
    </div>`);
  } else {
    sections.push(`<div class="card"><h2>${esc(S.strings.coverage)}</h2><div class="empty">${esc(S.strings.coverageEmpty)}</div></div>`);
  }

  sections.push(`
    <div class="card"><h2>${esc(S.strings.signals)}</h2>
      ${!S.report || S.report.signals.length === 0 ? `<div class="empty">${esc(S.strings.signalsEmpty)}</div>` : `
      <div class="rows">${S.report.signals
        .map(
          (s) => `
        <div class="row">
          <span class="mono">${esc(s.subjectRef)}</span>
          <div class="grow"><div class="sub">${esc(s.note)}</div></div>
          ${s.total !== undefined ? `<span class="score">${esc(s.note.includes("[PROXY]") ? "proxy total" : "total")} <b>${num(s.total, 0)}</b></span>` : ""}
          ${s.velocity !== undefined ? `<span class="score">velocity/7d <b>${num(s.velocity)}</b></span>` : ""}
        </div>`,
        )
        .join("")}</div>`}
    </div>`);

  const opportunities = S.report?.opportunities ?? [];
  const opportunityCards = opportunities
    .map(
      (o, i) => `
      <div class="opportunity">
        <div class="head"><span class="rank">#${i + 1}</span><span class="message">${esc(o.hypothesis.pattern.message)}</span></div>
        <div class="sub" style="color:var(--fg-subtle);margin-top:4px;font-size:12px">
          ${esc(S.locale === "zh" ? "钩子" : "hook")}: “${esc(o.hypothesis.pattern.hook)}” · format ${esc(o.hypothesis.pattern.format)} · ${esc(o.hypothesis.pattern.demonstration)} · CTA ${esc(o.hypothesis.pattern.cta)}
        </div>
        <div class="scores">
          <span class="score">${esc(S.strings.scoreObserved)} <b>${num(o.observed)}</b></span>
          <span class="score">${esc(S.strings.scoreCrossSource)} <b>${num(o.crossSourceSupport)}</b></span>
          <span class="score">${esc(S.strings.scorePredicted)} <b>${num(o.predicted, 0)}</b></span>
          <span class="score">${esc(S.strings.scoreConfidence)} <b>${num(o.confidence, 2)}</b></span>
          <span class="score">${esc(S.strings.forecast)} <b>${num(o.hypothesis.predictedOutcome.low, 0)}–${num(o.hypothesis.predictedOutcome.high, 0)} ${esc(o.hypothesis.predictedOutcome.metricKey)}</b></span>
        </div>
        <div class="evidence-refs">${esc(S.strings.evidenceRefs)} <span class="refs">${o.hypothesis.supportedBy.map((e) => esc(e.ref)).join(", ")}</span>
          ${o.hypothesis.contradictedBy.length > 0 ? `<br/>${esc(S.strings.contrary)} <span class="refs">${o.hypothesis.contradictedBy.map((e) => esc(e.ref)).join(", ")}</span>` : ""}
        </div>
        <div class="sub" style="margin-top:6px">${esc(o.explanation)}</div>
      </div>`,
    )
    .join("");
  sections.push(`
    <div class="card"><h2>${esc(S.strings.opportunities)} <span class="count">${opportunities.length}</span></h2>
      ${opportunities.length === 0 ? `<div class="empty">${esc(S.strings.opportunitiesEmpty)}</div>` : opportunityCards}
    </div>`);

  if (nextStep) {
    sections.push(`<div class="notice info"><b>${esc(S.strings.nextSteps)}:</b> ${esc(nextStep)}</div>`);
  }

  sections.push(`
    <div class="card">
      <h2>${esc(S.locale === "zh" ? "平台调研" : "Platform research")}</h2>
      <button class="primary" id="research-btn" ${S.researchBusy ? "disabled" : ""}>${esc(S.researchBusy ? S.strings.researching : S.strings.research)}</button>
      <span class="hint">${esc(S.locale === "zh" ? "幂等：重复运行不会产生重复记录。" : "Idempotent — running twice creates no duplicates.")}</span>
    </div>`);

  return sections.join("");
}

function renderEvidence(): string {
  if (!S.evidence) return `<div class="loading">${esc(S.strings.loading)}</div>`;
  const { ads, organic, metrics } = S.evidence;
  const parts: string[] = [];

  parts.push(`
    <div class="card"><h2>${esc(S.strings.ads)} <span class="count">${ads.length}</span></h2>
      ${ads.length === 0 ? `<div class="empty">${esc(S.strings.missing)}</div>` : `
      <table class="data"><thead><tr><th>ID</th><th>${esc(S.strings.provenance)}</th><th>advertiser</th><th>format</th><th>shown</th></tr></thead>
      <tbody>${ads
        .map(
          (a) => `
        <tr>
          <td class="mono">${esc(a.id)}</td>
          <td class="mono">${esc(a.source.sourceId)} v${esc(a.source.connectorVersion)}</td>
          <td class="mono">${esc(a.advertiserId ?? S.strings.missing)}</td>
          <td>${esc(a.format)}</td>
          <td class="mono">${a.firstShownAt ? `${esc(a.firstShownAt.slice(0, 10))} → ${esc((a.lastShownAt ?? a.firstShownAt).slice(0, 10))}` : esc(S.strings.missing)}</td>
        </tr>`,
        )
        .join("")}</tbody></table>`}
    </div>`);

  parts.push(`
    <div class="card"><h2>${esc(S.strings.organic)} <span class="count">${organic.length}</span></h2>
      ${organic.length === 0 ? `<div class="empty">${esc(S.strings.missing)}</div>` : `
      <table class="data"><thead><tr><th>ID</th><th>${esc(S.strings.provenance)}</th><th>published</th><th>format</th></tr></thead>
      <tbody>${organic
        .map(
          (o) => `
        <tr>
          <td class="mono">${esc(o.id)}</td>
          <td class="mono">${esc(o.source.sourceId)} v${esc(o.source.connectorVersion)}</td>
          <td class="mono">${esc((o.publishedAt ?? S.strings.missing).slice(0, 10))}</td>
          <td>${esc(o.format)}</td>
        </tr>`,
        )
        .join("")}</tbody></table>`}
    </div>`);

  const shown = metrics.slice(0, 60);
  parts.push(`
    <div class="card"><h2>${esc(S.strings.metrics)} <span class="count">${metrics.length}</span></h2>
      ${metrics.length === 0 ? `<div class="empty">${esc(S.strings.missing)}</div>` : `
      <table class="data"><thead><tr><th>subject</th><th>metric</th><th>value</th><th>${esc(S.strings.observedAt)}</th><th>${esc(S.strings.provenance)}</th></tr></thead>
      <tbody>${shown
        .map(
          (m) => `
        <tr>
          <td class="mono">${esc(m.subjectRef)}</td>
          <td>${esc(m.metricKey)}</td>
          <td class="mono">${esc(String(m.value))}</td>
          <td class="mono">${esc(m.observedAt)}</td>
          <td class="mono">${esc(m.source.sourceId)}</td>
        </tr>`,
        )
        .join("")}</tbody></table>
      ${metrics.length > shown.length ? `<div class="hint" style="margin-top:6px">… ${metrics.length - shown.length} more</div>` : ""}`}
    </div>`);

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Event wiring (called after every render)
// ---------------------------------------------------------------------------
function wire(): void {
  document.querySelectorAll<HTMLElement>("[data-mission]").forEach((el) => {
    el.onclick = () => actions.selectMission(el.dataset.mission ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => {
    const tab = el.dataset.tab;
    el.onclick = () =>
      actions.selectTab(tab === "evidence" ? "evidence" : tab === "creative" ? "creative" : tab === "loop" ? "loop" : "report");
  });
  if (S.tab === "creative") wireCreative();
  if (S.tab === "loop") wireLoop();
  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) refreshBtn.onclick = () => void actions.refreshAll();
  const newBtn = document.getElementById("new-mission-btn");
  if (newBtn) newBtn.onclick = () => void actions.startNewMissionFlow();

  const form = document.getElementById("start-form") as HTMLFormElement | null;
  if (form) form.onsubmit = () => void actions.submitStart(form);

  const discoverForm = document.getElementById("discover-form") as HTMLFormElement | null;
  if (discoverForm) {
    discoverForm.onsubmit = () => void actions.submitDiscover(discoverForm);
    const confirmBtn = document.getElementById("confirm-all-btn");
    if (confirmBtn)
      confirmBtn.onclick = () =>
        void actions.submitDiscover(
          discoverForm,
          (selectedMission()?.competitors ?? []).map((c) => c.displayName),
        );
  }

  const researchBtn = document.getElementById("research-btn");
  if (researchBtn) researchBtn.onclick = () => actions.runResearch();
}
