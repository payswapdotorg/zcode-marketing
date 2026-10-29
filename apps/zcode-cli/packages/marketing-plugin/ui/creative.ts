/**
 * Marketing workspace panel — the Creative tab (W4): the production handoff
 * surface. Ranked hypotheses → "Draft handoff pack" → review/approve →
 * produce the asset in a creative platform (prompt packs are copy-ready) →
 * bring it back (chunked file import + declaration) → the versioned rubric
 * report → comparison. Every element renders what the marketing tools
 * returned; the rubric verdicts and provenance stay verbatim.
 */
import type { CreativeArtifact } from "./types.ts";
import { S, esc } from "./state.ts";

/** Creative-tab actions, provided by the app module (ui/panel.ts). */
export interface CreativeActions {
  draftForHypothesis: (hypothesisId: string) => Promise<void>;
  reviewArtifact: (artifactId: string, decision: "approve" | "reject") => Promise<void>;
  recordProducedAsset: (form: HTMLFormElement) => Promise<void>;
}

let creativeActions: CreativeActions;

export const setCreativeActions = (value: CreativeActions): void => {
  creativeActions = value;
};

const STATUS_CLASS: Record<string, string> = {
  review: "partial",
  approved: "ok",
  rejected: "gap",
  published: "published",
  draft: "partial",
};

const SEVERITY_CLASS: Record<string, string> = {
  pass: "ok",
  warn: "partial",
  fail: "gap",
};

export function renderCreative(): string {
  if (!S.creative) return `<div class="loading">${esc(S.strings.loading)}</div>`;
  const { hypotheses, artifacts } = S.creative;
  const packs = artifacts.filter((a) => a.kindOf === "promptPack");
  const assets = artifacts.filter((a) => a.kindOf === "uploadedAsset");
  const parts: string[] = [];

  // --- hypotheses + drafting -------------------------------------------
  parts.push(`
    <div class="card">
      <h2>${esc(S.locale === "zh" ? "创意机会（已持久化）" : "Ranked hypotheses")} <span class="count">${hypotheses.length}</span></h2>
      ${hypotheses.length === 0
        ? `<div class="empty">${esc(S.locale === "zh" ? "还没有排序后的假设 — 运行机会排序后即可起草创意交接包。" : "No ranked hypotheses yet — rank opportunities first, then draft the handoff pack.")}</div>`
        : `<div class="rows">${hypotheses
            .map(
              (h, i) => `
        <div class="row">
          <span class="rank">#${i + 1}</span>
          <div class="grow"><b>${esc(h.pattern.message)}</b>
            <div class="sub">${esc(h.pattern.hook)} · ${esc(h.pattern.format)} · ${esc(S.strings.scoreConfidence)} ${h.confidence.toFixed(2)}</div></div>
          <button class="ghost" data-draft="${esc(h.id)}" ${S.draftBusy ? "disabled" : ""}>${esc(S.locale === "zh" ? "起草交接包" : "Draft handoff pack")}</button>
        </div>`,
            )
            .join("")}</div>`}
    </div>`);

  // --- prompt-pack artifacts --------------------------------------------
  for (const pack of packs) {
    const brief = pack.brief;
    const script = brief.script ?? [];
    const prompts = brief.generatorPromptPacks ?? {};
    parts.push(`
    <div class="card">
      <h2><span class="state ${STATUS_CLASS[pack.status] ?? "partial"}">${esc(pack.status)}</span>
        ${esc(S.locale === "zh" ? "创意交接包" : "Creative handoff pack")} <span class="count mono">${esc(pack.id)}</span></h2>
      <div class="kv" style="margin-bottom:10px">
        <dt>${esc(S.locale === "zh" ? "角度" : "Angle")}</dt><dd>${esc(brief.intent?.angle ?? "")}</dd>
        <dt>${esc(S.locale === "zh" ? "钩子" : "Hook")}</dt><dd>${esc(brief.blueprint?.hook ?? "")}</dd>
        <dt>${esc(S.locale === "zh" ? "格式" : "Format")}</dt><dd>${esc(brief.blueprint?.format ?? "")}</dd>
        <dt>${esc(S.locale === "zh" ? "实验" : "Experiment")}</dt><dd>${esc(String(brief.experimentSpec?.metric ?? ""))} · ${esc(String(brief.experimentSpec?.windowDays ?? ""))}d · ${esc((brief.experimentSpec?.changedVariables ?? []).join(", "))}</dd>
        <dt>${esc(S.locale === "zh" ? "起草" : "Drafted by")}</dt><dd class="mono">${esc(brief.draftedBy ?? "")}</dd>
      </div>
      ${script.length > 0 ? `
      <table class="data"><thead><tr><th>${esc(S.locale === "zh" ? "时间" : "Time")}</th><th>${esc(S.locale === "zh" ? "台词" : "Line")}</th><th>${esc(S.locale === "zh" ? "画面" : "Visual")}</th></tr></thead>
      <tbody>${script
        .map(
          (beat) => `
        <tr><td class="mono">${beat.startSec}-${beat.endSec}s</td><td>${esc(beat.line)}${beat.onScreenText ? ` <span class="sub">[${esc(beat.onScreenText)}]</span>` : ""}</td><td>${esc(beat.visual)}</td></tr>`,
        )
        .join("")}</tbody></table>` : ""}
      ${prompts.videoGen?.prompt ? `
      <div class="evidence-refs">${esc(S.locale === "zh" ? "视频生成提示词" : "Video-gen prompt")}:
        <pre class="mono" style="white-space:pre-wrap;background:var(--surface);border-radius:8px;padding:8px 10px;margin:4px 0 0">${esc(prompts.videoGen.prompt)}
${esc(S.locale === "zh" ? "负向约束" : "Negative")}: ${esc((prompts.videoGen.negativeConstraints ?? []).join("; "))}</pre></div>` : ""}
      ${prompts.thumbnail?.prompt ? `
      <div class="evidence-refs" style="margin-top:6px">${esc(S.locale === "zh" ? "封面提示词" : "Thumbnail prompt")}:
        <pre class="mono" style="white-space:pre-wrap;background:var(--surface);border-radius:8px;padding:8px 10px;margin:4px 0 0">${esc(prompts.thumbnail.prompt)}</pre></div>` : ""}
      ${(prompts.copy?.titleVariants ?? []).length > 0 ? `
      <div class="evidence-refs" style="margin-top:6px">${esc(S.locale === "zh" ? "文案变体" : "Copy variants")}:
        <ul style="margin:4px 0 0;padding-left:18px">${(prompts.copy?.titleVariants ?? []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${pack.status === "review" || pack.status === "rejected" ? `
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="primary" data-review-approve="${esc(pack.id)}" ${S.reviewBusy === pack.id ? "disabled" : ""}>${esc(S.locale === "zh" ? "批准" : "Approve")}</button>
        <button class="ghost" data-review-reject="${esc(pack.id)}" ${S.reviewBusy === pack.id ? "disabled" : ""}>${esc(S.locale === "zh" ? "驳回" : "Reject")}</button>
      </div>` : ""}
    </div>`);
  }

  // --- bring-back form ---------------------------------------------------
  parts.push(`
    <div class="card">
      <h2>${esc(S.locale === "zh" ? "带回已产出的素材（W4 闭环）" : "Bring back the produced asset (W4 gate)")}</h2>
      <form id="record-asset-form">
        <div class="form-grid">
          <label class="field">${esc(S.locale === "zh" ? "基于交接包" : "Produced from pack")}
            <select name="artifactId" required>
              ${packs.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} [${esc(p.status)}]</option>`).join("")}
            </select>
          </label>
          <label class="field">${esc(S.locale === "zh" ? "格式" : "Format")}
            <select name="format"><option value="video">video</option><option value="image">image</option></select>
          </label>
          <label class="field">${esc(S.locale === "zh" ? "时长（秒）" : "Duration (sec)")}<input name="durationSec" type="number" min="1" max="900" value="30"/></label>
          <label class="field">${esc(S.locale === "zh" ? "画幅" : "Aspect ratio")}
            <select name="aspectRatio"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select>
          </label>
          <label class="field wide">${esc(S.locale === "zh" ? "开场钩子（第一句/首屏文案）" : "Opening hook (first line / on-screen text)")}<input name="hookText" required maxlength="2000"/></label>
          <label class="field wide">${esc(S.locale === "zh" ? "证明元素" : "Proof element")}<input name="proofText" required maxlength="2000"/></label>
          <label class="field wide">${esc(S.locale === "zh" ? "结尾 CTA" : "Closing CTA")}<input name="ctaText" required maxlength="2000"/></label>
          <label class="field wide">${esc(S.locale === "zh" ? "完整文案/字幕" : "Full transcript / copy")}<textarea name="transcriptOrCopy" required maxlength="20000"></textarea></label>
          <label class="field wide">${esc(S.locale === "zh" ? "素材文件（导入任务工作区）" : "Asset file (imported into the mission workspace)")}
            <input type="file" name="file"/>
            <span class="hint">${esc(S.locale === "zh" ? "导入采用分块传输；未选择文件时仅记录声明（rubric 会提示）。" : "Chunked import; without a file only the declaration is recorded (the rubric warns).")}</span>
          </label>
          <label class="field wide"><button class="primary" type="submit" ${S.recordBusy ? "disabled" : ""}>${esc(S.recordBusy ? (S.locale === "zh" ? "导入并校验中…" : "Importing & validating…") : S.locale === "zh" ? "导入并校验" : "Import & validate")}</button></label>
        </div>
      </form>
    </div>`);

  // --- uploaded assets + rubric reports ---------------------------------
  for (const asset of assets) renderAssetCard(asset, parts);

  return parts.join("");
}

function renderAssetCard(asset: CreativeArtifact, parts: string[]): void {
  const rubric = asset.brief.rubric;
  const declaration = asset.brief.declaration;
  parts.push(`
    <div class="card">
      <h2><span class="state ${STATUS_CLASS[asset.status] ?? "partial"}">${esc(asset.status)}</span>
        ${esc(S.locale === "zh" ? "已带回的素材" : "Recorded asset")} <span class="count mono">${esc(asset.id)}</span>
        ${rubric ? `<span class="state ${rubric.verdict === "ready" ? "ok" : rubric.verdict === "blocked" ? "gap" : "partial"}">${esc(rubric.verdict)} · ${rubric.score.toFixed(2)}</span>` : ""}</h2>
      <div class="kv" style="margin-bottom:10px">
        <dt>${esc(S.locale === "zh" ? "钩子" : "Hook")}</dt><dd>${esc(declaration?.hookText ?? "")}</dd>
        <dt>${esc(S.locale === "zh" ? "证明" : "Proof")}</dt><dd>${esc(declaration?.proofText ?? "")}</dd>
        <dt>CTA</dt><dd>${esc(declaration?.ctaText ?? "")}</dd>
        <dt>${esc(S.locale === "zh" ? "规格" : "Spec")}</dt><dd>${esc(declaration?.format ?? "")}${declaration?.durationSec ? ` · ${declaration.durationSec}s` : ""}${declaration?.aspectRatio ? ` · ${declaration.aspectRatio}` : ""}</dd>
        ${declaration?.file ? `<dt>${esc(S.locale === "zh" ? "文件" : "File")}</dt><dd class="mono">${esc(declaration.file.name)} (${declaration.file.bytes} B) → ${esc(declaration.file.path)}</dd>` : ""}
        <dt>${esc(S.locale === "zh" ? "校验" : "Rubric")}</dt><dd class="mono">${esc(rubric?.rubricVersion ?? "")} · ${esc(rubric?.assessedBy ?? "")}</dd>
      </div>
      ${rubric ? `
      <div class="rows">${rubric.checks
        .map(
          (c) => `
        <div class="row">
          <span class="state ${SEVERITY_CLASS[c.severity] ?? "partial"}">${esc(c.severity)}</span>
          <div class="grow"><b class="mono">${esc(c.id)}</b><div class="sub">${esc(c.message)}${c.suggestion ? ` → ${esc(c.suggestion)}` : ""}</div></div>
        </div>`,
        )
        .join("")}</div>` : `<div class="empty">no rubric report</div>`}
      ${asset.status === "review" || asset.status === "rejected" ? `
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="primary" data-review-approve="${esc(asset.id)}" ${S.reviewBusy === asset.id ? "disabled" : ""}>${esc(S.locale === "zh" ? "批准" : "Approve")}</button>
        <button class="ghost" data-review-reject="${esc(asset.id)}" ${S.reviewBusy === asset.id ? "disabled" : ""}>${esc(S.locale === "zh" ? "驳回" : "Reject")}</button>
      </div>` : ""}
    </div>`);
}

/** Wire the creative tab controls (called after every render of the tab). */
export function wireCreative(): void {
  document.querySelectorAll<HTMLElement>("[data-draft]").forEach((el) => {
    el.onclick = () => void creativeActions.draftForHypothesis(el.dataset.draft ?? "");
  });
  document.querySelectorAll<HTMLElement>("[data-review-approve]").forEach((el) => {
    el.onclick = () => void creativeActions.reviewArtifact(el.dataset.reviewApprove ?? "", "approve");
  });
  document.querySelectorAll<HTMLElement>("[data-review-reject]").forEach((el) => {
    el.onclick = () => void creativeActions.reviewArtifact(el.dataset.reviewReject ?? "", "reject");
  });
  const form = document.getElementById("record-asset-form") as HTMLFormElement | null;
  if (form) form.onsubmit = () => void creativeActions.recordProducedAsset(form);
}
