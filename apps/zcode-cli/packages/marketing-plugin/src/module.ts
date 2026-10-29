/**
 * marketing-plugin 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 *
 * requires 中的 provider/provider-node 仅由 W3-3 real-host verification 证据脚本
 * （scripts/w3-3-seed-personal-provider.mts）使用：通过生产 provider-config
 * repository 写入沙箱隔离的个人 provider 配置。dist/server.mjs 不 import 它们。
 */
export const marketingPluginModule = {
  id: "marketing-plugin",
  requires: ["marketing", "provider", "provider-node"],
  provides: ["marketing-plugin"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
