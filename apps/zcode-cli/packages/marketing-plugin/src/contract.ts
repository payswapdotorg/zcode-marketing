/**
 * marketing-plugin 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 *
 * 需要正确调用本插件的只有两个调用方：
 *  1. ZCode 运行时的插件装载器（读 .zcode-plugin/plugin.json + requiredSeedPaths），
 *  2. Agent/模型（按 MARKETING-CAPABILITY-MAP.md 的能力映射调用 marketing_* 工具）。
 * 运行时行为契约（工具语义、诚实规则、覆盖口径）归 docs/marketing/，这里只钉住
 * 包裹层保证不变的交付物与调用面。
 */

/** 插件名，与 .zcode-plugin/plugin.json 的 name 及官方定义登记一致。 */
export const MARKETING_PLUGIN_NAME = "marketing";

/** 构建后在插件根目录下必定存在的产物；官方 seed 缺任一项即视为残缺插件。 */
export const MARKETING_PLUGIN_OUTPUTS = ["dist/server.mjs", "dist/panel.html"] as const;

/** 随插件发布的技能文件（requiredSeedPaths 的另一部分，模型可见的作业指引）。 */
export const MARKETING_PLUGIN_SKILL = "skills/marketing/SKILL.md" as const;

/** mission 状态在用户工作区下的落点（索引 + 每任务一个 SQLite 时序库）。 */
export const MARKETING_WORKSPACE_DIR = ".zcode/marketing" as const;
export const MARKETING_MISSIONS_INDEX = ".zcode/marketing/missions-index.json" as const;
export const MARKETING_MISSION_DB = ".zcode/marketing/missions/<missionId>.sqlite" as const;
/** W4：每任务的创意状态（排名后的假设 + 创意工件），与索引同构持久化。 */
export const MARKETING_MISSION_ARTIFACTS = ".zcode/marketing/missions/<missionId>-artifacts.json" as const;
/** W4：面板导入的资产文件落点。 */
export const MARKETING_MISSION_ASSETS = ".zcode/marketing/missions/<missionId>/assets/" as const;
/** W5：已连接发布账号的凭证存储（access token 只落在这里，工具永不回显）。 */
export const MARKETING_CONNECTIONS = ".zcode/marketing/connections.json" as const;

/** 本波次注册的 MCP 工具（输入/输出 schema 见 src/server.ts；语义见 docs/marketing/）。 */
export const MARKETING_TOOLS = [
  "marketing_mission_start",
  "marketing_mission_list",
  "marketing_discover_competitors",
  "marketing_research_platform",
  "marketing_analyze_creative",
  "marketing_rank_opportunities",
  "marketing_mission_report",
  "marketing_evidence_view",
  // W4 — creative strategy & production handoff.
  "marketing_draft_creative",
  "marketing_list_artifacts",
  "marketing_review_artifact",
  "marketing_asset_import_begin",
  "marketing_asset_import_write",
  "marketing_asset_import_finish",
  "marketing_record_asset",
  "marketing_compare_assets",
  // W5 — authorized publishing (organic only; NEVER paid campaign execution).
  "marketing_connect_publish_account",
  "marketing_list_connections",
  "marketing_publish_asset",
  "marketing_assisted_handoff",
  "marketing_record_manual_publication",
  "marketing_verify_publication",
  "marketing_list_publications",
  // W6 — measurement & closed-loop learning.
  "marketing_open_experiment",
  "marketing_collect_analytics",
  "marketing_record_outcome",
] as const;

export type MarketingTool = (typeof MARKETING_TOOLS)[number];

/** W3-4：工作台面板作为 ui:// 资源由 marketing server 提供（office 面板同款约定）。 */
export const MARKETING_PANEL = {
  surfaceId: "marketing",
  resourceUri: "ui://marketing/panel.html",
  mimeType: "text/html;profile=mcp-app",
} as const;

/** 路由到面板的工具（结果同步刷新面板）：其余工具保持纯数据可见性（仅 model）。 */
export const MARKETING_PANEL_TOOLS = [
  "marketing_mission_start",
  "marketing_discover_competitors",
  "marketing_research_platform",
  "marketing_mission_report",
  "marketing_evidence_view",
  // W4 creative handoff surfaces.
  "marketing_draft_creative",
  "marketing_list_artifacts",
  "marketing_review_artifact",
  "marketing_record_asset",
  "marketing_compare_assets",
  // W5/W6 loop surfaces.
  "marketing_connect_publish_account",
  "marketing_list_connections",
  "marketing_publish_asset",
  "marketing_assisted_handoff",
  "marketing_record_manual_publication",
  "marketing_verify_publication",
  "marketing_list_publications",
  "marketing_open_experiment",
  "marketing_collect_analytics",
  "marketing_record_outcome",
] as const;

/** W5 发布工具集（闭合清单）：organic 发布，绝不隐含 paidAds 权限域。 */
export const MARKETING_PUBLISHING_TOOLS = [
  "marketing_connect_publish_account",
  "marketing_list_connections",
  "marketing_publish_asset",
  "marketing_assisted_handoff",
  "marketing_record_manual_publication",
  "marketing_verify_publication",
] as const;

export interface MarketingPluginContract {
  /** 插件名（= MCP server 名 = 官方定义 id 前缀）。 */
  name: typeof MARKETING_PLUGIN_NAME;
  /** 构建保证产出的文件，相对插件根目录。 */
  outputs: typeof MARKETING_PLUGIN_OUTPUTS;
  /** 技能文件路径，相对插件根目录。 */
  skill: typeof MARKETING_PLUGIN_SKILL;
  /** 工具集。W5 起包含 organic 发布工具（MARKETING_PUBLISHING_TOOLS 闭合子集，绝不隐含 paidAds）。 */
  tools: readonly MarketingTool[];
  /**
   * Mission 持久化位置（相对用户工作区根）。前置条件：进程对工作区有写权限；
   * 后置条件：索引与 SQLite 库始终可被下一次进程重启读取（无内存独占状态）。
   */
  workspace: {
    dir: typeof MARKETING_WORKSPACE_DIR;
    missionIndex: typeof MARKETING_MISSIONS_INDEX;
    missionDb: typeof MARKETING_MISSION_DB;
    missionArtifacts: typeof MARKETING_MISSION_ARTIFACTS;
    missionAssets: typeof MARKETING_MISSION_ASSETS;
    connections: typeof MARKETING_CONNECTIONS;
  };
  /**
   * 模型通道契约（W3-2）：结构化抽取只经宿主 MCP `sampling/createMessage`
   * 通道（宿主声明 sampling 能力才会绑定）；没有该通道或通道失败时回退到
   * 已标注的启发式适配器，回退原因写进每条记录的 provenance
   * （extractionModelRef），绝不静默替换。永不旁路直连 provider。
   */
  modelChannel: {
    provenancePrefix: "zcode:routed:";
    fallbackMarker: "(fallback:";
    heuristicPrefix: "heuristic:";
  };
}
