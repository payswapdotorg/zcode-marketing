/**
 * MOS "Marketing connections" 分区的数据源台账状态模型（docs/marketing/MOS-INTAKE.md §4 行 15/§8 MOS-05）。
 * 状态只来自 docs/marketing/MARKETING-DATA-SOURCES.md 的已签署行 —— 设置页渲染台账，不重declare、
 * 不做任何实时探测（one owner per state：核验状态的唯一所有者是台账，连接状态的唯一所有者是
 * WO-P1 连接记录）。台账更新时同步本表；行上的日期是台账证据日期，不是今天。
 */
export type MarketingConnectionState =
  | "verified"
  | "implemented-not-connected"
  | "candidate";

export interface MarketingConnectionLedgerRow {
  id: string;
  /** i18n key：连接项名称。 */
  labelId: string;
  /** i18n key：一行状态说明（含台账事实日期）。 */
  detailId: string;
  state: MarketingConnectionState;
}

/** 台账最后签署的核验日期（MARKETING-DATA-SOURCES.md "Last updated"）。 */
export const MARKETING_CONNECTION_LEDGER_AS_OF = "2026-10-29";

export const MARKETING_CONNECTION_LEDGER_ROWS: readonly MarketingConnectionLedgerRow[] = [
  {
    id: "youtube-public-research",
    labelId: "settings.marketingConnections.youtubePublic.label",
    detailId: "settings.marketingConnections.youtubePublic.detail",
    state: "verified",
  },
  {
    id: "google-ads-transparency-center",
    labelId: "settings.marketingConnections.googleAtc.label",
    detailId: "settings.marketingConnections.googleAtc.detail",
    state: "verified",
  },
  {
    id: "youtube-account-connection",
    labelId: "settings.marketingConnections.youtubeAccount.label",
    detailId: "settings.marketingConnections.youtubeAccount.detail",
    state: "implemented-not-connected",
  },
  {
    id: "meta-ad-library",
    labelId: "settings.marketingConnections.metaAdLibrary.label",
    detailId: "settings.marketingConnections.metaAdLibrary.detail",
    state: "candidate",
  },
  {
    id: "tiktok-content-posting",
    labelId: "settings.marketingConnections.tiktok.label",
    detailId: "settings.marketingConnections.tiktok.detail",
    state: "candidate",
  },
];

/**
 * 状态 → 展示徽标的 i18n key。徽标语义与台账四级分类一致：
 * verified（已核验）/ implemented-not-connected（已实现、无生产连接记录）/
 * candidate（候选，未核验 —— 绝不能显示成任何形式的“已连接”）。
 */
export const MARKETING_CONNECTION_STATE_BADGE_IDS: Record<
  MarketingConnectionState,
  string
> = {
  verified: "settings.marketingConnections.badge.verified",
  "implemented-not-connected": "settings.marketingConnections.badge.notConnected",
  candidate: "settings.marketingConnections.badge.candidate",
};
