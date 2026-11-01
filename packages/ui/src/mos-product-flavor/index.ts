/**
 * mos-product-flavor 模块公共入口（architecture-policy publicEntrypoint）。
 * MOS（marketing flavor）在 ui 层的新增面统一从这里导出；模块内其余文件为模块私有。
 */
export {
  MARKETING_QUICK_START_PROMPTS,
  MARKETING_QUICK_START_PROMPT_IDS,
  withMarketingQuickStartPrompts,
} from "./marketingDraftPrompts.js";
export type { DraftSuggestedPromptItemLike } from "./marketingDraftPrompts.js";
export {
  MARKETING_SCHEDULED_TEMPLATES,
  withMarketingScheduledTemplates,
} from "./marketingAutomationTemplates.js";
export type { AutomationTemplateCatalogLike } from "./marketingAutomationTemplates.js";
export {
  MARKETING_CONNECTION_LEDGER_AS_OF,
  MARKETING_CONNECTION_LEDGER_ROWS,
  MARKETING_CONNECTION_STATE_BADGE_IDS,
} from "./marketingConnectionsData.js";
export type {
  MarketingConnectionLedgerRow,
  MarketingConnectionState,
} from "./marketingConnectionsData.js";
export { MarketingConnectionsSection } from "./MarketingConnectionsSection.js";
export { AboutMosSection, resolveMosCurrentStateRows } from "./AboutMosSection.js";
export {
  MarketingCapabilitiesCard,
  shouldRenderMarketingCapabilitiesCard,
} from "./MarketingCapabilitiesCard.js";
