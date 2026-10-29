/**
 * Marketing workspace panel — the Publish & Measure tab (W5/W6): the loop
 * surface. Connected publishing accounts (sandbox-labeled) → publish an
 * APPROVED asset through the account (idempotent) or take the assisted
 * package out for manual publishing (verified back through the keyless
 * public route) → open the measurement window → collect permitted analytics →
 * record the outcome against the PRESERVED forecast → the [PROXY]-labeled
 * comparison, appended calibration history, and the next-experiment
 * recommendation.
 *
 * Honesty rules stay verbatim in the UI: sandbox publications are badged as
 * test-account posts, verification methods are shown, coverage notes render,
 * and the proxy discipline is visible — the panel only renders what the
 * marketing tools returned, never a parallel interpretation.
 */
import type { CreativeArtifact } from "./types.ts";
import { S, esc } from "./state.ts";

/** Loop-tab actions, provided by the app module (ui/panel.ts). */
export interface LoopActions {
  connectAccount: (form: HTMLFormElement) => Promise<void>;
  publishAsset: (artifactId: string) => Promise<void>;
  assistedHandoff: (artifactId: string) => Promise<void>;
  recordManualPublication: (form: HTMLFormElement) => Promise<void>;
  verifyPublication: (publicationId: string) => Promise<void>;
  openExperiment: (publicationId: string) => Promise<void>;
  collectAnalytics: (publicationId: string) => Promise<void>;
  recordOutcome: (form: HTMLFormElement) => Promise<void>;
}

let loopActions: LoopActions;

export const setLoopActions = (value: LoopActions): void => {
  loopActions = value;
};

const PUB_STATUS_CLASS: Record<string, string> = {
  pending: "partial",
  published: "partial",
  verified: "ok",
  failed: "gap",
};

const zh = (en: string, zhText: string): string => (S.locale === "zh" ? zhText : en);

export function renderLoop(): string {
  const parts: string[] = [];
  parts.push(renderConnections());
  parts.push(renderPublishables());
  parts.push(renderPublications());
  parts.push(renderExperiments());
  return parts.join("");
}

// --- connected publishing accounts ---------------------------------------
function renderConnections(): string {
  const rows = S.connections
    .map(
      (c) => `
      <div class="row">
        <span class="state ${c.environment === "sandbox" ? "partial" : "ok"}">${esc(c.environment)}</span>
        <div class="grow"><b>${esc(c.label)}</b>
          <div class="sub">${esc(c.platform)} · ${esc(c.accountRef)} · ${esc(S.locale === "zh" ? "连接者" : "connected by")} ${esc(c.connectedBy)}</div></div>
      </div>`,
    )
    .join("");
  return `
    <div class="card">
      <h2>${esc(zh("Connected publishing accounts", "已连接的发布账号"))} <span class="count">${S.connections.length}</span></h2>
      ${S.connections.length === 0 ? `<div class="empty">${esc(zh("No connected account — publish through the assisted handoff, or connect a (test) account below.", "尚未连接账号 — 可使用辅助交接发布，或在下方连接（测试）账号。"))}</div>` : `<div class="rows">${rows}</div>`}
      <form id="connect-account-form" style="margin-top:10px">
        <div class="form-grid">
          <label class="field">${esc(zh("Label", "标签"))}<input name="label" required maxlength="200" placeholder="${esc(zh("sandbox test channel", "沙盒测试频道"))}"/></label>
          <label class="field">${esc(zh("Platform", "平台"))}
            <select name="platform"><option value="youtube">youtube</option><option value="tiktok">tiktok</option><option value="meta">meta</option></select>
          </label>
          <label class="field">${esc(zh("Channel / account id", "频道 / 账号 ID"))}<input name="accountRef" required maxlength="200" placeholder="UC…"/></label>
          <label class="field">${esc(zh("Environment", "环境"))}
            <select name="environment"><option value="sandbox">sandbox (${esc(zh("test account", "测试账号"))})</option><option value="production">production</option></select>
          </label>
          <label class="field wide">${esc(zh("Data API base URL", "Data API 基址"))}<input name="dataBase" type="url" required value="https://www.googleapis.com"/></label>
          <label class="field wide">${esc(zh("Access token", "访问令牌"))}<input name="accessToken" type="password" required maxlength="4096"/>
            <span class="hint">${esc(zh("Stored in the workspace credential area only — never displayed or returned by any tool.", "仅存于工作区凭证区 — 任何工具都不会回显。"))}</span>
          </label>
          <label class="field wide"><button class="primary" type="submit" ${S.connectBusy ? "disabled" : ""}>${esc(S.connectBusy ? zh("Connecting…", "连接中…") : zh("Connect account", "连接账号"))}</button></label>
        </div>
      </form>
    </div>`;
}

// --- publishable assets ----------------------------------------------------
function renderPublishables(): string {
  const publishable = (S.creative?.artifacts ?? []).filter(
    (a: CreativeArtifact) => a.kindOf === "uploadedAsset" && (a.status === "approved" || a.status === "published"),
  );
  if (publishable.length === 0) {
    return `
    <div class="card">
      <h2>${esc(zh("Publish", "发布"))}</h2>
      <div class="empty">${esc(zh("No approved produced asset yet — approve a brought-back asset in the Creative tab first.", "还没有已批准的产出素材 — 先在「创意」标签批准带回的素材。"))}</div>
    </div>`;
  }
  const rows = publishable
    .map((a) => {
      const published = (S.loop?.publications ?? []).some((p) => p.artifactId === a.id);
      return `
      <div class="row">
        <span class="state ${a.status === "published" ? "ok" : "partial"}">${esc(a.status)}</span>
        <div class="grow"><b class="mono">${esc(a.id)}</b>
          <div class="sub">${esc((a.brief.declaration?.hookText ?? "").slice(0, 80))}</div></div>
        ${published ? `<span class="sub">${esc(zh("published", "已发布"))}</span>` : `
        <button class="primary" data-publish="${esc(a.id)}" ${S.publishBusy === a.id ? "disabled" : ""}>${esc(zh("Publish", "发布"))}</button>
        <button class="ghost" data-handoff="${esc(a.id)}" ${S.publishBusy === a.id ? "disabled" : ""}>${esc(zh("Assisted package", "辅助包"))}</button>`}
      </div>`;
    })
    .join("");
  return `
    <div class="card">
      <h2>${esc(zh("Publish an approved asset (W5)", "发布已批准的素材（W5）"))} <span class="count">${publishable.length}</span></h2>
      <div class="rows">${rows}</div>
      ${S.connections.length === 0 ? `<div class="sub" style="margin-top:8px">${esc(zh("No connected account: publishing goes out as the assisted package for manual publishing (verified back through the keyless public route).", "未连接账号：将生成辅助包供手动发布（经无凭证公开路线回验）。"))}</div>` : ""}
      <form id="manual-publication-form" style="margin-top:12px">
        <div class="form-grid">
          <label class="field">${esc(zh("Asset", "素材"))}
            <select name="artifactId" required>${publishable.map((a) => `<option value="${esc(a.id)}">${esc(a.id)} [${esc(a.status)}]</option>`).join("")}</select>
          </label>
          <label class="field wide">${esc(zh("Manually published URL (assisted path)", "手动发布后的 URL（辅助路径）"))}<input name="url" type="url" required placeholder="https://www.youtube.com/watch?v=…"/>
            <span class="hint">${esc(zh("Verified through the keyless public oEmbed route; unresolvable URLs are recorded as user-attested only.", "经无凭证 oEmbed 公开路线验证；无法解析的 URL 仅按用户自述记录。"))}</span>
          </label>
          <label class="field wide"><button class="ghost" type="submit">${esc(zh("Record manual publication", "记录手动发布"))}</button></label>
        </div>
      </form>
    </div>`;
}

// --- publications -----------------------------------------------------------
function renderPublications(): string {
  const publications = S.loop?.publications ?? [];
  if (publications.length === 0) return "";
  const rows = publications
    .map((p) => {
      const hasExperiment = (S.loop?.experiments ?? []).some((e) => e.publicationId === p.id);
      return `
      <div class="row">
        <span class="state ${PUB_STATUS_CLASS[p.status] ?? "partial"}">${esc(p.status)}</span>
        <div class="grow"><b class="mono">${esc(p.id)}</b>
          <div class="sub">${esc(p.assistedHandoff ? zh("assisted", "辅助") : zh("direct", "直发"))} · ${esc(p.platform)}${p.environment === "sandbox" ? ` · <b>${esc(zh("SANDBOX test account", "沙盒测试账号"))}</b>` : ""}${p.verification ? ` · ${esc(zh("verified", "验证"))}: ${esc(p.verification.method)}` : ""}</div>
          <div class="sub mono">${esc(p.externalPostId ?? p.url ?? "")}</div></div>
        ${p.status !== "verified" ? `<button class="ghost" data-verify="${esc(p.id)}" ${S.measureBusy === p.id ? "disabled" : ""}>${esc(zh("Verify", "验证"))}</button>` : ""}
        ${!hasExperiment ? `<button class="primary" data-open-experiment="${esc(p.id)}" ${S.measureBusy === p.id ? "disabled" : ""}>${esc(zh("Measure", "开窗测量"))}</button>` : ""}
      </div>`;
    })
    .join("");
  return `
    <div class="card">
      <h2>${esc(zh("Publications", "发布记录"))} <span class="count">${publications.length}</span></h2>
      <div class="rows">${rows}</div>
    </div>`;
}

// --- experiments: window, analytics, outcome, recommendation ----------------
function renderExperiments(): string {
  const experiments = S.loop?.experiments ?? [];
  if (experiments.length === 0) return "";
  const parts: string[] = [];
  for (const e of experiments) {
    const publication = (S.loop?.publications ?? []).find((p) => p.id === e.publicationId);
    const nextAction = (S.loop?.nextActions ?? []).find((a) => a.experimentId === e.id);
    parts.push(`
    <div class="card">
      <h2>${esc(zh("Experiment", "实验"))} <span class="count mono">${esc(e.id)}</span>
        ${e.result ? `<span class="state ok">${esc(zh("completed", "已完成"))}</span>` : `<span class="state partial">${esc(zh("measuring", "测量中"))}</span>`}</h2>
      <div class="kv" style="margin-bottom:10px">
        <dt>${esc(zh("Goal metric", "目标指标"))}</dt><dd>${esc(e.goalMetricKey)}</dd>
        <dt>${esc(zh("Changed variables", "改变变量"))}</dt><dd>${esc(e.changedVariables.join(", "))}</dd>
        <dt>${esc(zh("Window", "窗口"))}</dt><dd>${e.measurementWindowDays}d · ${esc(zh("from", "自"))} ${esc(e.startedAt.slice(0, 10))}</dd>
        ${publication ? `<dt>${esc(zh("Post", "帖子"))}</dt><dd class="mono">${esc(publication.externalPostId ?? publication.url ?? "")}</dd>` : ""}
      </div>
      ${!e.result && publication?.externalPostId ? `
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="ghost" data-collect="${esc(e.publicationId)}" ${S.measureBusy === e.publicationId ? "disabled" : ""}>${esc(zh("Collect permitted analytics", "采集许可分析"))}</button>
      </div>` : !e.result ? `<div class="sub" style="margin-bottom:10px">${esc(zh("Connected-account analytics need a publishing connection; manual publications record the outcome from what you can observe.", "连接账号分析需要已连接的发布账号；手动发布的帖子按你实际观察记录结果。"))}</div>` : ""}
      ${e.result ? renderOutcome(e, nextAction) : renderOutcomeForm(e)}
    </div>`);
  }
  return parts.join("");
}

function renderOutcome(e: import("./types.ts").Experiment, nextAction: import("./types.ts").NextAction | undefined): string {
  const result = e.result!;
  const proxy = result.observedMetricKey !== e.goalMetricKey;
  const simulation = (S.loop?.simulations ?? []).find((s) => s.hypothesisId === e.hypothesisId);
  const calibration = simulation?.calibrationHistory ?? [];
  return `
    <div class="kv" style="margin-bottom:10px">
      <dt>${esc(zh("Observed", "观测"))}</dt><dd><b>${result.observedValue}</b> ${esc(zh("on", "on"))} <b>${esc(result.observedMetricKey)}</b>${proxy ? ` <span class="state partial">[PROXY]</span>` : ""} · ${esc(zh("forecast preserved verbatim", "预测原样保留"))}</dd>
      <dt>${esc(zh("Completed", "完成于"))}</dt><dd>${esc(result.completedAt.slice(0, 10))}</dd>
    </div>
    ${result.supported.length > 0 ? `<div class="rows">${result.supported.map((s) => `<div class="row"><span class="state ok">${esc(zh("keep", "保留"))}</span><div class="grow sub">${esc(s)}</div></div>`).join("")}</div>` : ""}
    ${result.contradicted.length > 0 ? `<div class="rows">${result.contradicted.map((s) => `<div class="row"><span class="state gap">${esc(zh("change", "改变"))}</span><div class="grow sub">${esc(s)}</div></div>`).join("")}</div>` : ""}
    ${calibration.length > 0 ? `
    <div class="evidence-refs" style="margin-top:8px">${esc(zh("Calibration history (appended, never overwritten)", "校准历史（只增不改）"))}:
      <ul style="margin:4px 0 0;padding-left:18px">${calibration.map((c) => `<li class="mono">${esc(c.evaluatedAt.slice(0, 10))} · ${esc(c.note)}</li>`).join("")}</ul>
    </div>` : ""}
    ${nextAction ? `
    <div class="evidence-refs" style="margin-top:8px"><b>${esc(zh("Next experiment (grounded in the recorded result)", "下一次实验（基于记录结果）"))}:</b> ${esc(nextAction.recommendation)}</div>` : ""}`;
}

function renderOutcomeForm(e: import("./types.ts").Experiment): string {
  return `
    <form id="record-outcome-form-${esc(e.id)}" data-experiment="${esc(e.id)}">
      <div class="form-grid">
        <label class="field">${esc(zh("Observed value", "观测值"))}<input name="observedValue" type="number" step="any" required/></label>
        <label class="field">${esc(zh("Observed on metric", "观测指标"))}
          <select name="observedMetricKey">
            <option value="${esc(e.goalMetricKey)}">${esc(e.goalMetricKey)} (${esc(zh("goal", "目标"))})</option>
            <option value="views">views (${esc(zh("proxy — needs baseline", "代理 — 需基线"))})</option>
          </select>
        </label>
        <label class="field">${esc(zh("Proxy baseline low / expected / high", "代理基线 低/预期/高"))}<input name="proxyLow" type="number" step="any"/> / <input name="proxyExpected" type="number" step="any"/> / <input name="proxyHigh" type="number" step="any"/>
          <span class="hint">${esc(zh("Required when observing a proxy metric — never compared against the goal metric range.", "观测代理指标时必填 — 绝不与目标指标区间直接比较。"))}</span>
        </label>
        <label class="field wide">${esc(zh("Source note", "来源说明"))}<input name="sourceNote" maxlength="500" placeholder="${esc(zh("e.g. connected-account analytics, platform UI total", "如：连接账号分析 / 平台界面累计"))}"/></label>
        <label class="field wide"><button class="primary" type="submit" ${S.outcomeBusy === e.id ? "disabled" : ""}>${esc(zh("Record outcome & close the loop", "记录结果并闭环"))}</button></label>
      </div>
    </form>`;
}

/** Wire the loop tab controls (called after every render of the tab). */
export function wireLoop(): void {
  const connectForm = document.getElementById("connect-account-form") as HTMLFormElement | null;
  if (connectForm) connectForm.onsubmit = () => void loopActions.connectAccount(connectForm);
  document.querySelectorAll<HTMLElement>("[data-publish]").forEach((el) => {
    el.onclick = () => void loopActions.publishAsset(el.dataset.publish ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-handoff]").forEach((el) => {
    el.onclick = () => void loopActions.assistedHandoff(el.dataset.handoff ?? "");
  });
  const manualForm = document.getElementById("manual-publication-form") as HTMLFormElement | null;
  if (manualForm) manualForm.onsubmit = () => void loopActions.recordManualPublication(manualForm);
  document.querySelectorAll<HTMLElement>("[data-verify]").forEach((el) => {
    el.onclick = () => void loopActions.verifyPublication(el.dataset.verify ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-open-experiment]").forEach((el) => {
    el.onclick = () => void loopActions.openExperiment(el.dataset.openExperiment ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-collect]").forEach((el) => {
    el.onclick = () => void loopActions.collectAnalytics(el.dataset.collect ?? "");
  });
  document.querySelectorAll<HTMLFormElement>("form[id^='record-outcome-form-']").forEach((form) => {
    form.onsubmit = () => void loopActions.recordOutcome(form);
  });
}
