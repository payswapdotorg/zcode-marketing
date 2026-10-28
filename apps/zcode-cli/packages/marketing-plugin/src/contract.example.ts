/**
 * marketing-plugin 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 展示插件宿主最常见的一次完整装配：读工作区根 -> 运行时 -> MCP 工具面（见 src/main.ts
 * 的真实 stdio 装配）。
 */
import { MARKETING_TOOLS, type MarketingPluginContract } from "./contract.js";
import { MarketingRuntime } from "./runtime.js";
import { createMarketingServer } from "./server.js";

export function exampleMarketingPlugin(
  contract: MarketingPluginContract,
  workspaceRoot: string,
): { toolNames: readonly string[]; runtime: MarketingRuntime; close(): Promise<void> } {
  if (contract.name !== "marketing") throw new Error("contract/name mismatch");
  const runtime = new MarketingRuntime(workspaceRoot);
  const server = createMarketingServer(runtime);
  return {
    toolNames: MARKETING_TOOLS,
    runtime,
    async close() {
      // 前置：工具调用都已结束；后置：SQLite 连接关闭，mission 状态已全部落盘。
      await runtime.close();
      await server.close();
    },
  };
}

/** 契约快照：本波次工具集（publishing 属 W5，不在此列）。 */
export function exampleToolRoster(): readonly string[] {
  return MARKETING_TOOLS;
}
