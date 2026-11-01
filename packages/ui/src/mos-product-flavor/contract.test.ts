/**
 * mos-product-flavor 模块契约测试（architecture-policy 管理模块自带 contract.test.ts 的仓库约定）。
 * 契约面：MOS（marketing flavor）在 ui 层新增的三个纯数据/合并模块 ——
 * 草稿快启推荐、定时任务模板、连接台账状态 —— 全部是「无状态、不持有运行时数据、
 * 非 marketing flavor 下不改变既有行为」的纯函数/常量模块。
 */
import { describe, expect, it } from "vitest";

import { withMarketingQuickStartPrompts } from "./marketingDraftPrompts.js";
import { withMarketingScheduledTemplates } from "./marketingAutomationTemplates.js";
import {
  MARKETING_CONNECTION_LEDGER_ROWS,
  MARKETING_CONNECTION_STATE_BADGE_IDS,
} from "./marketingConnectionsData.js";

describe("mos-product-flavor module contract", () => {
  it("三个入口都存在且为纯函数/常量导出", () => {
    expect(typeof withMarketingQuickStartPrompts).toBe("function");
    expect(typeof withMarketingScheduledTemplates).toBe("function");
    expect(Array.isArray(MARKETING_CONNECTION_LEDGER_ROWS)).toBe(true);
    expect(MARKETING_CONNECTION_STATE_BADGE_IDS.verified).toContain(
      "settings.marketingConnections.badge.",
    );
  });

  it("非 marketing flavor 下合并函数恒等（默认构建行为不变）", () => {
    const prompts = [{ id: "x", label: { en: "x" }, prompt: { en: "x" } }];
    expect(withMarketingQuickStartPrompts(prompts, "production")).toEqual(prompts);
    const catalog = {
      scheduled: [],
      offPeak: [],
      rejectedScheduledTemplateIds: [],
    };
    expect(withMarketingScheduledTemplates(catalog, "preview")).toBe(catalog);
  });
});
