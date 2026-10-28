import { defineConfig } from "vitest/config";

// 本包自己的包含规则（CLI 顶层配置只收 packages/*/test/**，不含 managed 模块的
// src/contract.test.ts 契约测试——架构治理要求契约测试与模块同目录）。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/contract.test.ts"],
  },
});
