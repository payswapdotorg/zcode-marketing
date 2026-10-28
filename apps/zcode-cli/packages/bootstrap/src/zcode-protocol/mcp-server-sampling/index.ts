import { mcpAppsSamplingResultSchema } from "@zcode/shared/mcp-apps";
import type { McpSamplingRequest, McpSamplingResult } from "@zcode/contracts";
import type { ZCodeProtocolAgentServerContext } from "../server-types.js";
import { MCP_SERVER_SAMPLING_MAX_PER_SESSION } from "./contract.js";

export * from "./contract.js";

/**
 * MCP server 采样（server → client `sampling/createMessage`）→ 宿主模型系统。
 *
 * 与 elicitation 同一归属纪律：采样必须挂在该 server 当前正在执行的工具调用上
 * （request.trace），找不到会话就拒绝而不是猜。会话模型经既有 `sampleModel` 运行
 * 时方法解析（provider registry、用量记账、可中止）——这是 MCP UI Apps 已经在用的
 * 同一条受控路径，插件不获得任何旁路。
 *
 * 预算：server 侧采样按会话计数（UI Apps 采样有每会话上限，工具链采样同样有界，
 * 防失控成本）。超限拒绝并如实说明，而不是静默放行。
 *
 * 契约语义见 ./contract.ts；治理见 docs/marketing/（W3-2）。
 */
const samplingCountBySession = new WeakMap<object, number>();

export async function requestMcpSampling(
  context: ZCodeProtocolAgentServerContext,
  request: McpSamplingRequest,
  options?: { signal?: AbortSignal },
): Promise<McpSamplingResult> {
  const sessionId = request.trace?.sessionId;
  if (!sessionId) {
    return {
      action: "decline",
      reason: "sampling request cannot be attributed to an active tool call",
    };
  }
  const record = context.sessions.get(sessionId);
  if (!record) {
    return {
      action: "decline",
      reason: `session '${sessionId}' is not active`,
    };
  }
  const used = samplingCountBySession.get(record) ?? 0;
  if (used >= MCP_SERVER_SAMPLING_MAX_PER_SESSION) {
    return {
      action: "decline",
      reason: `session sampling budget exhausted (${MCP_SERVER_SAMPLING_MAX_PER_SESSION} calls)`,
    };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await record.app.sampleModel(
      {
        request: request.request,
        source: {
          pluginId: request.serverName,
          serverName: request.serverName,
          appIdentity: `mcp-server:${request.serverName}`,
        },
      },
      {
        abortSignal: controller.signal,
        traceContext: record.traceContext,
      },
    );
    samplingCountBySession.set(record, used + 1);
    const parsed = mcpAppsSamplingResultSchema.parse(result);
    return { action: "accept", ...parsed };
  } catch (error) {
    // 失败不占预算；拒绝以 decline 语义回给 adapter，由其映射为 JSON-RPC error。
    return {
      action: "decline",
      reason: `host sampling failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}
