import { describe, expect, it } from "vitest";

import { marketingPluginModule } from "./module.js";
import {
  MARKETING_MISSIONS_INDEX,
  MARKETING_PANEL,
  MARKETING_PANEL_TOOLS,
  MARKETING_PLUGIN_OUTPUTS,
  MARKETING_PLUGIN_SKILL,
  MARKETING_TOOLS,
  type MarketingPluginContract,
} from "./contract.js";
import { exampleMarketingPlugin, exampleToolRoster } from "./contract.example.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
// （跨进程真实现验证：scripts/w3-chain.mjs 驱动 dist/server.mjs 全链路。）
describe("marketing-plugin contract", () => {
  it("declares its module manifest", () => {
    expect(marketingPluginModule.id).toBe("marketing-plugin");
    expect(marketingPluginModule.requires).toContain("marketing");
  });

  it("declares the plugin outputs the official seed depends on", () => {
    expect([...MARKETING_PLUGIN_OUTPUTS, MARKETING_PLUGIN_SKILL]).toEqual([
      "dist/server.mjs",
      "dist/panel.html",
      "skills/marketing/SKILL.md",
    ]);
  });

  it("keeps the tool roster free of publishing tools (W5 scope, separate permission domain)", () => {
    expect(MARKETING_TOOLS.every((name) => !name.includes("publish"))).toBe(true);
  });

  it("declares the workspace panel surface exactly once, on the marketing server", () => {
    expect(MARKETING_PANEL.surfaceId).toBe("marketing");
    expect(MARKETING_PANEL.resourceUri).toBe("ui://marketing/panel.html");
    expect(MARKETING_PANEL.mimeType).toBe("text/html;profile=mcp-app");
    expect(MARKETING_PANEL_TOOLS.every((name) => MARKETING_TOOLS.includes(name))).toBe(true);
    expect(new Set(MARKETING_PANEL_TOOLS).size).toBe(MARKETING_PANEL_TOOLS.length);
  });

  it("roots every mission artifact under the workspace .zcode/marketing directory", () => {
    expect(MARKETING_MISSIONS_INDEX.startsWith(".zcode/marketing/")).toBe(true);
  });

  it("assembles through the public example exactly like the hosted entry", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp("marketing-contract-"),
    );
    try {
      const { toolNames, close } = exampleMarketingPlugin(
        // 结构性快照：示例只依赖契约字段，不依赖实现细节。
        {
          name: "marketing",
          outputs: MARKETING_PLUGIN_OUTPUTS,
          skill: MARKETING_PLUGIN_SKILL,
          tools: MARKETING_TOOLS,
          workspace: {
            dir: ".zcode/marketing",
            missionIndex: MARKETING_MISSIONS_INDEX,
            missionDb: ".zcode/marketing/missions/<missionId>.sqlite",
          },
          modelChannel: {
            provenancePrefix: "zcode:routed:",
            fallbackMarker: "(fallback:",
            heuristicPrefix: "heuristic:",
          },
        } satisfies MarketingPluginContract,
        root,
      );
      expect([...toolNames]).toEqual([...exampleToolRoster()]);
      await close();
    } finally {
      await import("node:fs/promises").then((fs) =>
        fs.rm(root, { recursive: true, force: true }),
      );
    }
  });
});
