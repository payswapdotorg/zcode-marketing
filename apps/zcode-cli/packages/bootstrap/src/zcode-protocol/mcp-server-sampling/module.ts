/**
 * mcp-server-sampling 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const mcpServerSamplingModule = {
  id: "mcp-server-sampling",
  requires: ["zcode-cli", "shared", "mcp-apps-protocol"],
  provides: ["mcp-server-sampling"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
