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
export const MARKETING_PLUGIN_OUTPUTS = ["dist/server.mjs"] as const;

/** 随插件发布的技能文件（requiredSeedPaths 的另一部分，模型可见的作业指引）。 */
export const MARKETING_PLUGIN_SKILL = "skills/marketing/SKILL.md" as const;

/** mission 状态在用户工作区下的落点（索引 + 每任务一个 SQLite 时序库）。 */
export const MARKETING_WORKSPACE_DIR = ".zcode/marketing" as const;
export const MARKETING_MISSIONS_INDEX = ".zcode/marketing/missions-index.json" as const;
export const MARKETING_MISSION_DB = ".zcode/marketing/missions/<missionId>.sqlite" as const;

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
] as const;

export type MarketingTool = (typeof MARKETING_TOOLS)[number];

export interface MarketingPluginContract {
  /** 插件名（= MCP server 名 = 官方定义 id 前缀）。 */
  name: typeof MARKETING_PLUGIN_NAME;
  /** 构建保证产出的文件，相对插件根目录。 */
  outputs: typeof MARKETING_PLUGIN_OUTPUTS;
  /** 技能文件路径，相对插件根目录。 */
  skill: typeof MARKETING_PLUGIN_SKILL;
  /** 工具集。发布工具（publishing）属于 W5，不在此波次。 */
  tools: readonly MarketingTool[];
  /**
   * Mission 持久化位置（相对用户工作区根）。前置条件：进程对工作区有写权限；
   * 后置条件：索引与 SQLite 库始终可被下一次进程重启读取（无内存独占状态）。
   */
  workspace: {
    dir: typeof MARKETING_WORKSPACE_DIR;
    missionIndex: typeof MARKETING_MISSIONS_INDEX;
    missionDb: typeof MARKETING_MISSION_DB;
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
