# mcp-server-sampling — MCP server 采样委托（sampling/createMessage → 宿主模型系统）

> Managed module（layer: app，owner: marketing-tl，W3-2 登记）。把 MCP server
> （非 UI App）发起的 `sampling/createMessage` 受控地委托到既有 `sampleModel`
> 运行时方法。治理背景见 docs/marketing/MARKETING-CAPABILITY-MAP.md
> "Real-model bridge" 与 WORK-REGISTRY.md W3-2。

## 边界

- 入口：`requestMcpSampling(context, request, options)`（index.ts）。
- 调用方只有一个：协议 server 的 `requestMcpSampling`（server.ts），其上游是
  `zcode-protocol-entrypoint.ts` 延迟绑定到 MCP adapter 连接池的
  `McpSamplingPort`；adapter 层（apps/zcode-cli/packages/adapters/src/mcp）负责
  capability 宣告、trace 归属与 zod 载荷验证。
- 依赖：`zcode-cli`（@zcode/contracts、server-types）、`shared`、
  `mcp-apps-protocol`（@zcode/shared/mcp-apps 的采样 zod 契约）。

## 不变量（违反即契约破坏）

1. **归属纪律**：无 `request.trace.sessionId`（或会话不活跃）→ 一律
   `{ action: "decline" }`，绝不猜测会话。采样只能发生在该 server 正在执行、
   用户已批准的工具调用期间 —— 与 elicitation 相同的安全边界。
2. **唯一执行路径**：成功采样只能经 `record.app.sampleModel`（会话模型由
   provider registry 解析、用量记账、可中止）。本模块永不直连任何 provider。
3. **预算有界**：每会话成功采样计数上限 `MCP_SERVER_SAMPLING_MAX_PER_SESSION`
   （失败不占预算）；超限 decline 并给出真实原因。
4. **结果验证**：成功结果必须通过 `mcpAppsSamplingResultSchema` 后才返回
   accept；任何异常都归一化为 `{ action: "decline", reason }`，由 adapter 层映射
   为 JSON-RPC error（sampling 结果没有协议级 decline）。
5. **来源可审计**：`source.pluginId/serverName/appIdentity`（`mcp-server:<name>`）
   随调用传给 `sampleModel`，进入 trace 属性与用量记账。

## 与相邻能力的关系

- `mcp-ui` 模块：UI App 采样（`uiSampling` 协议方法）有自己的实例校验与预算，
  与本模块互不复用计数；两者最终都收敛到同一个 `sampleModel` 运行时方法。
- 营销插件（marketing-plugin）：作为 sampling 的主要消费方，其 `McpSamplingModel`
  适配器在采样被拒/失败时回退到已标注的启发式适配器，并把原因写进每条记录的
  provenance（extractionModelRef），绝不静默替换。

## 测试

- 本目录 `contract.test.ts`：契约结构（module manifest、预算上限、decline 语义）。
- `apps/zcode-cli/packages/marketing-plugin`：w3-2-sampling-chain.mjs 驱动真实
  stdio server 进程全链路（含 decline 相位），证据见 docs/marketing/evidence/。
