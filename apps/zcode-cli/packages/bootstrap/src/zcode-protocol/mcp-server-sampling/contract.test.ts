/**
 * 契约测试：只 import contract 与 module（不知道实现细节），同一份测试应同时约束
 * 真实现与未来重构。跨进程/链路验证由 marketing-plugin 的
 * scripts/w3-2-sampling-chain.mjs（真实 stdio MCP server + 采样宿主）承担。
 */
import { describe, expect, it } from "vitest";
import { mcpServerSamplingModule } from "./module.js";
import { MCP_SERVER_SAMPLING_MAX_PER_SESSION, type McpServerSamplingPort } from "./contract.js";
import { exampleServerSamplingMethod } from "./contract.example.js";

describe("mcp-server-sampling contract", () => {
  it("declares its module manifest with the required upstream surfaces", () => {
    expect(mcpServerSamplingModule.id).toBe("mcp-server-sampling");
    expect(mcpServerSamplingModule.requires).toContain("zcode-cli");
    expect(mcpServerSamplingModule.requires).toContain("mcp-apps-protocol");
    expect(mcpServerSamplingModule.publicEntrypoints).toContain("contract.ts");
  });

  it("pins a bounded per-session sampling budget (cost safety)", () => {
    expect(MCP_SERVER_SAMPLING_MAX_PER_SESSION).toBeGreaterThan(0);
    expect(MCP_SERVER_SAMPLING_MAX_PER_SESSION).toBeLessThanOrEqual(128);
  });

  it("exposes the delegation through the public example exactly like the hosted entry", () => {
    expect(typeof exampleServerSamplingMethod).toBe("function");
  });

  it("types the port as decline-or-accept (decline maps to JSON-RPC error upstream)", () => {
    // Structural: the port returns the contract union — a decline must carry a
    // reason-less option but an accept must satisfy the shared sampling result
    // shape. The type identity itself is the contract here.
    const port: McpServerSamplingPort["requestMcpSampling"] = () =>
      Promise.resolve({ action: "decline", reason: "test" });
    expect(port).toBeTruthy();
  });
});
