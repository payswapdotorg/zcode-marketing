import { ZCODE_PRODUCT_FLAVOR, type ZCodeProductFlavor } from "@zcode/shared";
import type {
  AutomationTemplateCatalog,
  ScheduledAutomationTemplate,
} from "@/settings/automationTemplateCatalog.js";

/**
 * MOS（marketing flavor）定时任务模板（docs/marketing/MOS-INTAKE.md §4 行 12 / §8 MOS-05）。
 * 四条模板对应原型 Automations 页：Weekly market pulse / Competitor movement scan /
 * Campaign review / Content calendar check。调度语义沿用原型给的表达（工作日 09:00 等）
 * 转成 cron；模板只是 prompt + 调度的预填 —— 执行走既有 ZCode 自动化运行时
 * （host cron 链路），不新建调度器；发布类动作仍受账号权限与显式批准约束。
 * 仅 marketing flavor 注入（Q-MOS-4），默认构建的模板列表不变。
 */
export const MARKETING_SCHEDULED_TEMPLATES: readonly ScheduledAutomationTemplate[] = [
  {
    id: "mos-template-weekly-market-pulse",
    cronExpr: "0 9 * * 1-5",
    icon: "activity",
    title: { en: "Weekly market pulse", cn: "每周市场脉搏" },
    description: {
      en: "Scan the market for movement worth acting on.",
      cn: "扫描市场中值得行动的变化。",
    },
    prompt: {
      en: "Run a market pulse scan for my product: summarize competitor ad and content movement since the last run, flag material changes, and cite the evidence records behind every claim.",
      cn: "为我的产品执行一次市场脉搏扫描：总结自上次运行以来的竞品广告与内容变化，标出实质性变化，并为每一条结论引用证据记录。",
    },
  },
  {
    id: "mos-template-competitor-movement-scan",
    cronExpr: "0 10 * * *",
    icon: "list",
    title: { en: "Competitor movement scan", cn: "竞品动向扫描" },
    description: {
      en: "Daily diff of competitor ads and organic content.",
      cn: "每日对比竞品广告与有机内容差异。",
    },
    prompt: {
      en: "Scan tracked competitors for new ads and organic content since yesterday; report only observed changes, each with its evidence record.",
      cn: "扫描已跟踪竞品自昨天以来的新广告与有机内容；只报告观察到的变化，并附各自的证据记录。",
    },
  },
  {
    id: "mos-template-campaign-review",
    cronExpr: "0 16 * * 1",
    icon: "target",
    title: { en: "Campaign review", cn: "投放复盘" },
    description: {
      en: "Weekly performance review of active campaigns.",
      cn: "活跃投放的每周表现复盘。",
    },
    prompt: {
      en: "Review this week's marketing performance against the experiments we are running: compare observed metrics with the preserved forecast and recommend the next experiment.",
      cn: "对照正在运行的实验复盘本周营销表现：将观测指标与保留的预测比较，并推荐下一个实验。",
    },
  },
  {
    id: "mos-template-content-calendar-check",
    cronExpr: "0 15 * * 3",
    icon: "file",
    title: { en: "Content calendar check", cn: "内容日历检查" },
    description: {
      en: "Wednesday check on upcoming content.",
      cn: "每周三检查近期内容安排。",
    },
    prompt: {
      en: "Check the content calendar for the next 14 days: flag gaps, deadlines, and anything waiting on review or approval.",
      cn: "检查未来 14 天的内容日历：标出空档、截止时间以及等待评审或批准的事项。",
    },
  },
];

/**
 * 把营销模板合并进 Client Scenes 生成的模板目录，语义与既有映射一致：
 * cron 无法安全编辑的模板进入 rejectedScheduledTemplateIds（不展示、可诊断），
 * 不会因为本地写死而绕过校验。
 */
export function withMarketingScheduledTemplates(
  catalog: AutomationTemplateCatalog,
  flavor: ZCodeProductFlavor = ZCODE_PRODUCT_FLAVOR,
  isValidCronExpr: (cronExpr: string) => boolean = () => true,
): AutomationTemplateCatalog {
  if (flavor !== "marketing") {
    return catalog;
  }
  const accepted: ScheduledAutomationTemplate[] = [];
  const rejected: string[] = [];
  for (const template of MARKETING_SCHEDULED_TEMPLATES) {
    if (isValidCronExpr(template.cronExpr)) {
      accepted.push(template);
    } else {
      rejected.push(template.id);
    }
  }
  return {
    ...catalog,
    scheduled: [...accepted, ...catalog.scheduled],
    rejectedScheduledTemplateIds: [
      ...catalog.rejectedScheduledTemplateIds,
      ...rejected,
    ],
  };
}

/** 类型别名：contract.ts 用 typeof import 引用目录形状。 */
export type AutomationTemplateCatalogLike = AutomationTemplateCatalog;
