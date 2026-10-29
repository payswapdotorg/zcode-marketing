# marketing-plugin

营销领域层（`@zcode/marketing`，治理唯一事实源 docs/marketing/）接入 CLI 运行时的内置插件包。
`.zcode-plugin/plugin.json` 声明 stdio MCP 服务器（`dist/server.mjs`）与 `skills/marketing`
技能；官方插件定义在 `apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts`
登记，`requiredSeedPaths` 与 `contract.ts` 的产物清单机械对应。

不变量：

- **运行时是唯一的执行引擎**（MARKETING-ARCHITECTURE-LOCK.md）：本包只做运行时装配——
  mission 工作区持久化（`.zcode/marketing/`）+ 已验证连接器的组合。不新增 planner loop、
  会话状态或模型旁路；所有结构化抽取经 `@zcode/marketing` 的能力路由端口。
- **构建必定产出 `contract.ts` 声明的产物**；官方 seed 缺任一项即视为残缺插件
  （`dist/server.mjs` 由 esbuild 全量打包，运行时不读取 `node_modules`）。
- **工具边界契约化**：每个 `marketing_*` 工具都有 zod inputSchema + outputSchema
  （输出复用领域记录），副作用经 annotations 声明；本波次无任何 destructive 工具，
  publishing 属 W5 且是独立权限域。
- **诚实口径不可协商**：覆盖缺口显式返回（`coverage_gap` 是正常结果，不是错误）；
  live 模式的付费侧来自已验证的 `connector:google-ads-transparency`（W1-3(b) 已于 2026-10-29 验证）；
  仅当任务真实观测到零条广告证据时排序工具才返回 `paid_source_gap` 类型化错误，
  绝不编造广告证据；demo 模式的合成 fixture 在每个覆盖切片与报告里标注。
- **mission 状态只落工作区**：索引 `missions-index.json` + 每任务一个 SQLite 时序库
  （复用 W2 的 `SqliteTemporalStore`，幂等摄取、显式修订）+ W4 创意状态
  `<missionId>-artifacts.json`（内容去重的稳定假设 id、创意工件、rubric 报告；进程重启后仍可读）
  + 面板导入的资产文件 `<missionId>/assets/`；进程重启后仍可读。
- **创意交接契约（W4）**：起草/审阅/导入/记录/比较全部走工具面（同一注册器）；
  批准必须显式（review→approved，非法迁移拒绝）；资产带回必须分块导入并校验字节数
  （不匹配即中止，绝不落半文件）；rubric 是版本化的建议者（v1：确定性规则检查 + 可路由的
  定性评估，provenance 记录 assessedBy）——只报告与建议，绝不改写创意、绝不自动批准。
- **连接器组合不越契约**：`CompositeConnector` 仅合并子连接器的返回页与覆盖切片
  （逐字保留，不修饰）；子连接器仍各自遵守 `PLATFORM-CONNECTOR-CONTRACT.md`。

与其它模块的交集：领域契约与工作流全部来自 `marketing` 模块（`requires: [marketing]`，
只允许公开入口导入）；插件装载、MCP 传输与权限门禁归 zcode-cli 运行时；W3 波次细节见
`docs/marketing/WORK-REGISTRY.md`（W3-1）与 `MARKETING-ROADMAP.md`。
