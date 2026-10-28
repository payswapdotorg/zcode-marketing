/**
 * mcp-server-sampling 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 展示宿主侧最常见的一次完整接线：协议 server 方法 → 委托入口（真实装配见
 * zcode-protocol/server.ts 的 requestMcpSampling 与 zcode-protocol-entrypoint.ts
 * 的延迟绑定）。
 */
import type { McpSamplingRequest, McpSamplingResult } from "@zcode/contracts";
import type { ZCodeProtocolAgentServerContext } from "../server-types.js";
import { requestMcpSampling } from "./index.js";

export function exampleServerSamplingMethod(
  context: ZCodeProtocolAgentServerContext,
  request: McpSamplingRequest,
  options?: { signal?: AbortSignal },
): Promise<McpSamplingResult> {
  // 前置：request.trace 挂在该 server 正在执行的工具调用上（adapter 层保证）。
  // 后置：成功结果已过 mcpAppsSamplingResultSchema 并计入会话预算；失败为 decline。
  return requestMcpSampling(context, request, options);
}
