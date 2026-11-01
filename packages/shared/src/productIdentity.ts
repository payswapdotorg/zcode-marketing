/**
 * MOS 产品身份描述符（docs/marketing/MOS-INTAKE.md §8 MOS-02 / D-MOS-1 选项 A）。
 *
 * 渲染层与桌面主进程共用的唯一身份真源：产品名、短名、标语与品牌标记字形都从这里读，
 * 不允许任何界面把 "MOS" 字面量写进默认构建 —— 非 marketing flavor 下 `markGlyph` 与
 * `tagline` 为 null，调用方据此走既有 ZCode 渲染，默认构建输出与引入前逐字一致。
 *
 * 身份本身由编译期 `ZCODE_PRODUCT_FLAVOR`（构建开关 `ZCODE_MOS_IDENTITY=1` 注入）决定；
 * 本模块只消费身份，不定义身份。
 */
import { ZCODE_PRODUCT_FLAVOR, type ZCodeProductFlavor } from "./env.js";

export interface ZCodeProductIdentity {
  /** 与 desktop-product-identity.mjs 的 flavor 同源（编译期常量）。 */
  readonly flavor: ZCodeProductFlavor;
  /** 完整产品名（安装包 productName 同源）。 */
  readonly productName: string;
  /** 短名（About 标题、菜单、徽标 aria-label 使用）。 */
  readonly shortName: string;
  /** 产品标语；默认身份没有标语，为 null。 */
  readonly tagline: string | null;
  /** 品牌标记字形（marketing 为字母标记 "M"）；默认身份保留 ZCode 图形 Logo，为 null。 */
  readonly markGlyph: string | null;
}

const ZCODE_IDENTITY: ZCodeProductIdentity = Object.freeze({
  flavor: ZCODE_PRODUCT_FLAVOR,
  productName: "ZCode",
  shortName: "ZCode",
  tagline: null,
  markGlyph: null,
});

const MOS_IDENTITY: ZCodeProductIdentity = Object.freeze({
  flavor: "marketing",
  productName: "MOS",
  shortName: "MOS",
  tagline: "The Marketing OS",
  markGlyph: "M",
});

/**
 * 当前构建的产品身份。编译期 flavor 常量让该三元在默认构建中折叠为 ZCode 分支，
 * marketing 身份（MOS）只在显式 `ZCODE_MOS_IDENTITY=1` 构建中出现。
 */
export const ZCODE_PRODUCT_IDENTITY: ZCodeProductIdentity =
  ZCODE_PRODUCT_FLAVOR === "marketing" ? MOS_IDENTITY : ZCODE_IDENTITY;
