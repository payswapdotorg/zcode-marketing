import { describe, expect, it } from "vitest";
import { isValidCronExpr } from "@zcode/services";
import type { AutomationTemplateCatalog } from "@/settings/automationTemplateCatalog.js";
import {
  MARKETING_SCHEDULED_TEMPLATES,
  withMarketingScheduledTemplates,
} from "@/mos-product-flavor/marketingAutomationTemplates.js";

const baseCatalog: AutomationTemplateCatalog = {
  scheduled: [
    {
      id: "scene-template-1",
      cronExpr: "0 9 * * 1-5",
      icon: "list",
      title: { en: "Scene template" },
      description: { en: "Scene description" },
      prompt: { en: "Scene prompt" },
    },
  ],
  offPeak: [],
  rejectedScheduledTemplateIds: [],
};

describe("marketing automation templates (MOS-05)", () => {
  it("四条模板与原型 Automations 页一一对应，调度沿用原型语义", () => {
    // 原型：Weekly market pulse（工作日 09:00）/ Competitor movement scan（每日 10:00）/
    // Campaign review（每周一 16:00）/ Content calendar check（每周三 15:00）。
    expect(MARKETING_SCHEDULED_TEMPLATES.map((t) => t.title.en)).toEqual([
      "Weekly market pulse",
      "Competitor movement scan",
      "Campaign review",
      "Content calendar check",
    ]);
    expect(MARKETING_SCHEDULED_TEMPLATES.map((t) => t.cronExpr)).toEqual([
      "0 9 * * 1-5",
      "0 10 * * *",
      "0 16 * * 1",
      "0 15 * * 3",
    ]);
    // 模板 cron 必须通过仓库的调度校验（无法安全编辑的模板不允许进入列表）。
    for (const template of MARKETING_SCHEDULED_TEMPLATES) {
      expect(isValidCronExpr(template.cronExpr)).toBe(true);
      // 诚实文案：双语齐全，prompt 是研究/复盘动作，不是发布动作。
      expect(template.prompt.en).toBeTruthy();
      expect(template.prompt.cn).toBeTruthy();
    }
  });

  it("marketing flavor 把营销模板并入定时列表最前，场景模板保持原序", () => {
    const merged = withMarketingScheduledTemplates(baseCatalog, "marketing", isValidCronExpr);
    expect(merged.scheduled.map((t) => t.id)).toEqual([
      ...MARKETING_SCHEDULED_TEMPLATES.map((t) => t.id),
      "scene-template-1",
    ]);
    expect(merged.rejectedScheduledTemplateIds).toEqual([]);
    expect(merged.offPeak).toEqual([]);
  });

  it("cron 校验失败的营销模板进入 rejected 列表而不是硬塞进列表", () => {
    const merged = withMarketingScheduledTemplates(
      baseCatalog,
      "marketing",
      () => false,
    );
    expect(merged.scheduled.map((t) => t.id)).toEqual(["scene-template-1"]);
    expect(merged.rejectedScheduledTemplateIds).toEqual(
      MARKETING_SCHEDULED_TEMPLATES.map((t) => t.id),
    );
  });

  it("非 marketing flavor 原样返回，默认构建模板列表不变", () => {
    for (const flavor of ["production", "preview"] as const) {
      expect(withMarketingScheduledTemplates(baseCatalog, flavor, isValidCronExpr)).toBe(
        baseCatalog,
      );
    }
  });
});
