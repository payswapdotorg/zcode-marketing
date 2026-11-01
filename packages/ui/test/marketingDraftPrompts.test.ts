import { describe, expect, it } from "vitest";

import {
  MARKETING_QUICK_START_PROMPTS,
  MARKETING_QUICK_START_PROMPT_IDS,
  withMarketingQuickStartPrompts,
} from "@/mos-product-flavor/marketingDraftPrompts.js";

describe("marketing draft quick-start prompts (MOS-03)", () => {
  it("三条快启与原型 New task 入口一一对应，双语齐全", () => {
    // 原型快启：市场机会扫描 / 创意简报 / 实验计划（MOS-INTAKE §4 行 3）。
    expect(MARKETING_QUICK_START_PROMPTS.map((item) => item.label.en)).toEqual([
      "Market opportunity scan",
      "Creative brief",
      "Experiment plan",
    ]);
    expect(MARKETING_QUICK_START_PROMPT_IDS).toEqual([
      "mos-quickstart-market-opportunity-scan",
      "mos-quickstart-creative-brief",
      "mos-quickstart-experiment-plan",
    ]);
    for (const item of MARKETING_QUICK_START_PROMPTS) {
      expect(item.prompt.en).toBeTruthy();
      expect(item.prompt.cn).toBeTruthy();
      expect(item.label.cn).toBeTruthy();
    }
  });

  it("marketing flavor 把快启并入推荐列表最前，场景推荐保持原序", () => {
    const sceneItems = [
      { id: "scene-1", label: { en: "Scene item" }, prompt: { en: "Scene prompt" } },
      { id: "scene-2", label: { en: "Scene item 2" }, prompt: { en: "Scene prompt 2" } },
    ];
    const merged = withMarketingQuickStartPrompts(sceneItems, "marketing");
    expect(merged.map((item) => item.id)).toEqual([
      ...MARKETING_QUICK_START_PROMPT_IDS,
      "scene-1",
      "scene-2",
    ]);
  });

  it("非 marketing flavor 原样返回（默认构建推荐列表不变，且不修改入参）", () => {
    for (const flavor of ["production", "preview"] as const) {
      const sceneItems = [
        { id: "scene-1", label: { en: "Scene item" }, prompt: { en: "Scene prompt" } },
      ];
      expect(withMarketingQuickStartPrompts(sceneItems, flavor)).toEqual(sceneItems);
      expect(sceneItems).toHaveLength(1);
    }
  });

  it("快启是 prompt-only：不携带 actions/plugin 绑定，点击只是预填", () => {
    for (const item of MARKETING_QUICK_START_PROMPTS) {
      expect("actions" in item).toBe(false);
      expect("plugin" in item).toBe(false);
    }
  });
});
