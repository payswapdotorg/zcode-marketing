/**
 * mos-product-flavor 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { MosProductFlavorContract } from "./contract.js";

export function exampleMosProductFlavor(contract: MosProductFlavorContract): void {
  // 最常见的一次调用：把 MOS 营销快启并入 Client Scenes 下发的草稿推荐。
  // 调用方（useDraftSuggestedPromptItems）以编译期 flavor 常量决定是否生效；
  // 非 marketing flavor 下本调用恒等返回，默认构建行为不变。
  const flavor = "marketing" as const;
  const sceneItems = [
    { id: "scene-1", label: { en: "Scene item" }, prompt: { en: "Scene prompt" } },
  ];
  const merged = contract.withMarketingQuickStartPrompts(sceneItems, flavor);
  if (merged.length <= sceneItems.length) {
    throw new Error("marketing flavor 必须把快启并入推荐列表最前");
  }

  // 模板合并同理，cron 校验失败的模板进 rejected 列表（与既有映射同一语义）。
  const catalog = contract.withMarketingScheduledTemplates(
    { scheduled: [], offPeak: [], rejectedScheduledTemplateIds: [] },
    flavor,
    () => true,
  );
  if (catalog.scheduled.length === 0 || catalog.rejectedScheduledTemplateIds.length !== 0) {
    throw new Error("合法 cron 的 MOS 模板必须进入 scheduled 列表");
  }

  // 连接台账行只在展示层渲染，不在此触发任何请求。
  if (contract.marketingConnectionLedgerRows.length === 0) {
    throw new Error("台账行不能为空");
  }
}
