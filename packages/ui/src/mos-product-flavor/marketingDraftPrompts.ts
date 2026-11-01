/**
 * MOS（marketing flavor）草稿快启推荐（docs/marketing/MOS-INTAKE.md §4 行 3 / §8 MOS-03）。
 * 快启是 prompt-only 的预填：点击只把 prompt 写入 composer，不创建会话、不预置状态、
 * 不绕过任何任务/项目机制（架构锁第 1 条 —— 营销能力是任务工具，不是独立工作区）。
 * 文案遵循诚实纪律：引用证据记录、说明覆盖边界，不承诺未核验的数据面。
 * 仅 marketing flavor 注入（Q-MOS-4），默认构建的推荐列表不变。
 */
import type { ZCodeProductFlavor } from "@zcode/shared";

export interface DraftSuggestedPromptItemLike {
  id: string;
  label: { en?: string; cn?: string };
  prompt: { en?: string; cn?: string };
  iconName?: string;
  iconUrl?: string;
}

export const MARKETING_QUICK_START_PROMPT_IDS = [
  "mos-quickstart-market-opportunity-scan",
  "mos-quickstart-creative-brief",
  "mos-quickstart-experiment-plan",
] as const;

/** 原型 New task 快启的三条入口（MOS-INTAKE §4 行 3），调度语义与文案随原型落地。 */
export const MARKETING_QUICK_START_PROMPTS: readonly DraftSuggestedPromptItemLike[] = [
  {
    id: "mos-quickstart-market-opportunity-scan",
    label: {
      en: "Market opportunity scan",
      cn: "市场机会扫描",
    },
    prompt: {
      en: "Scan my market for evidence-backed opportunities: summarize competitor ad and content movement, flag material changes since the last review, and cite the evidence records behind every claim.",
      cn: "扫描我所在市场的、有证据支撑的机会：总结竞品广告与内容动向，标出与上次复盘相比的实质性变化，并为每一条结论引用证据记录。",
    },
    iconName: "compass",
  },
  {
    id: "mos-quickstart-creative-brief",
    label: {
      en: "Creative brief",
      cn: "创意简报",
    },
    prompt: {
      en: "Draft a creative brief for my next piece of content: state the objective and audience, list the claims we can support with evidence today, and mark any claim that still needs verification.",
      cn: "为我的下一条内容起草创意简报：写明目标与受众，列出今天已有证据支撑的主张，并标出仍需核验的主张。",
    },
    iconName: "pen",
  },
  {
    id: "mos-quickstart-experiment-plan",
    label: {
      en: "Experiment plan",
      cn: "实验计划",
    },
    prompt: {
      en: "Plan my next marketing experiment: define one hypothesis with a measurable outcome, list the data sources we can actually observe today, and preserve the forecast so results can be compared honestly later.",
      cn: "规划我的下一个营销实验：定义一个可度量的假设，列出今天真正能观测到的数据源，并保留预测以便之后诚实地对照结果。",
    },
    iconName: "flask",
  },
];

/**
 * 把营销快启并入 Client Scenes 下发的草稿推荐列表最前；非 marketing flavor
 * 原样返回新数组（不修改入参元素），默认构建行为不变。
 * 泛型保留调用方的条目类型（DraftSuggestedPromptItem 及其扩展）。
 */
export function withMarketingQuickStartPrompts<
  T extends DraftSuggestedPromptItemLike,
>(items: readonly T[], flavor: ZCodeProductFlavor): T[] {
  if (flavor !== "marketing") {
    return [...items];
  }
  // 快启条目只有 Like 的五个字段；T 的其余字段（iconStyle/actions/plugin 等）都是可选，
  // 结构上缺省即合法，因此这一处断言是安全的。
  return [...MARKETING_QUICK_START_PROMPTS, ...items] as T[];
}
