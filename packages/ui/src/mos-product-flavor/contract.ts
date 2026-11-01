/**
 * mos-product-flavor 对外契约：MOS（marketing flavor）在 ui 层的全部新增面。
 * 调用方要知道的一切写在这里；其余对外不可见。
 *
 * 模块只提供三类无状态的东西：
 * 1. 纯数据/合并函数 —— 非 marketing flavor 下恒等或原样返回，默认构建行为不变；
 * 2. 展示组件 —— 只渲染入参或编译期常量，不发请求、不持有运行时状态；
 * 3. 组件挂载点由调用方的编译期 flavor 分支决定，默认构建不渲染任何 MOS 文案。
 */
export type MosProductFlavorId = string & { readonly __brand: "MosProductFlavorId" };

export interface MosProductFlavorContract {
  /** 把 MOS 营销快启并入草稿推荐列表；非 marketing flavor 原样返回新数组。 */
  readonly withMarketingQuickStartPrompts: typeof import("./marketingDraftPrompts.js").withMarketingQuickStartPrompts;

  /** 把 MOS 定时模板并入模板目录；cron 校验失败进 rejected 列表；非 marketing flavor 恒等。 */
  readonly withMarketingScheduledTemplates: typeof import("./marketingAutomationTemplates.js").withMarketingScheduledTemplates;

  /** 营销连接台账行；核验状态的唯一事实来源是 docs/marketing/MARKETING-DATA-SOURCES.md。 */
  readonly marketingConnectionLedgerRows: typeof import("./marketingConnectionsData.js").MARKETING_CONNECTION_LEDGER_ROWS;
}
