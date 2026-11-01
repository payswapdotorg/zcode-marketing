import { describe, expect, it } from "vitest";

import { ZCODE_PRODUCT_IDENTITY } from "../src/productIdentity.js";
import { ZCODE_ENV, ZCODE_PRODUCT_FLAVOR, normalizeZCodeProductFlavor } from "../src/env.js";

/**
 * MOS 产品身份描述符契约（docs/marketing/MOS-INTAKE.md §8 MOS-02）：
 * 非 marketing 构建下描述符与历史常量逐字一致；marketing 值只在显式身份构建中出现。
 */
describe("shared productIdentity", () => {
  it("身份与编译期 flavor 同源且枚举合法", () => {
    expect(ZCODE_PRODUCT_IDENTITY.flavor).toBe(ZCODE_PRODUCT_FLAVOR);
    expect(["production", "preview", "marketing"]).toContain(ZCODE_PRODUCT_FLAVOR);
  });

  it("非 marketing 构建保持 ZCode 身份，且不携带标语/标记字形", () => {
    if (ZCODE_PRODUCT_FLAVOR !== "marketing") {
      expect(ZCODE_PRODUCT_IDENTITY).toEqual({
        flavor: ZCODE_PRODUCT_FLAVOR,
        productName: "ZCode",
        shortName: "ZCode",
        tagline: null,
        markGlyph: null,
      });
    }
  });

  it("marketing 身份是 MOS · The Marketing OS，标记字形为 M", () => {
    if (ZCODE_PRODUCT_FLAVOR === "marketing") {
      expect(ZCODE_PRODUCT_IDENTITY).toEqual({
        flavor: "marketing",
        productName: "MOS",
        shortName: "MOS",
        tagline: "The Marketing OS",
        markGlyph: "M",
      });
    }
  });

  it("normalizeZCodeProductFlavor 接受 marketing 并保持既有缺省语义", () => {
    expect(normalizeZCodeProductFlavor("marketing", "production")).toBe("marketing");
    expect(normalizeZCodeProductFlavor("  MARKETING  ", "test")).toBe("marketing");
    // 缺省跟随后端环境：测试 bundle 永远不是 marketing（MOS 只能来自显式构建开关）。
    expect(normalizeZCodeProductFlavor(undefined, "test")).toBe("preview");
    expect(normalizeZCodeProductFlavor(undefined, "production")).toBe("production");
    expect(normalizeZCodeProductFlavor("garbage", ZCODE_ENV)).toBe(
      ZCODE_ENV === "production" ? "production" : "preview",
    );
  });
});
