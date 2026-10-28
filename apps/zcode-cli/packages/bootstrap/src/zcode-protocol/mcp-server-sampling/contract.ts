/**
 * mcp-server-sampling 契约：MCP server（非 UI App）发起的 `sampling/createMessage`
 * 在 agent 侧的受控委托。调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 *
 * 语义契约（docs/marketing/MARKETING-CAPABILITY-MAP.md "Real-model bridge" 与
 * WORK-REGISTRY W3-2）：
 *  - 归属纪律：采样请求必须挂在该 server 正在执行的工具调用 trace 上；无 trace
 *    （空闲期主动采样）一律 decline，绝不猜会话 —— 与 elicitation 同一安全边界。
 *  - 载荷验证：用 `@zcode/shared/mcp-apps` 的 `mcpAppsSamplingParamsSchema`（宿主与
 *    MCP Apps 共用同一份 zod 契约，两侧不会一放一拒）。
 *  - 唯一执行路径：委托到既有 `sampleModel` 运行时方法 —— 会话模型经 provider
 *    registry 解析、用量记账（recordModelUsageFact）、可中止；插件无旁路。
 *  - 预算：每会话上限 `MCP_SERVER_SAMPLING_MAX_PER_SESSION` 次成功采样，超限拒绝。
 *  - 拒绝语义：decline 以 `{ action: "decline", reason }` 返回给 adapter 层，由其映射
 *    为 JSON-RPC error（sampling 结果没有协议级 decline）；server 侧据此回退并如实记录。
 */
import type { McpSamplingRequest, McpSamplingResult } from "@zcode/contracts";

/** server 采样每会话的受控预算（成功调用计数；失败不占预算）。 */
export const MCP_SERVER_SAMPLING_MAX_PER_SESSION = 64;

/**
 * 委托入口。前置条件：request.trace.sessionId 对应的会话处于活跃状态；
 * 后置条件：成功结果通过 `mcpAppsSamplingResultSchema` 验证且计入会话预算。
 */
export interface McpServerSamplingPort {
  requestMcpSampling(request: McpSamplingRequest, options?: { signal?: AbortSignal }): Promise<McpSamplingResult>;
}
