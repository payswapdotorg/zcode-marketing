import { describe, expect, it } from "vitest";

import {
  MARKETING_CONNECTION_LEDGER_AS_OF,
  MARKETING_CONNECTION_LEDGER_ROWS,
  MARKETING_CONNECTION_STATE_BADGE_IDS,
} from "@/mos-product-flavor/marketingConnectionsData.js";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

/**
 * AT-MOS-9 的数据面：Marketing connections 分区渲染的每一行都能对应到
 * docs/marketing/MARKETING-DATA-SOURCES.md 的已签署行；没有一行声明台账不支持的
 * 状态（尤其是：不允许任何“已连接”的账号状态 —— 没有生产同意流运行记录）。
 */
describe("marketing connections ledger rows (MOS-05, AT-MOS-9 data face)", () => {
  it("台账行覆盖两条已核验公开源、一条已实现未连接账号通道、两条候选源", () => {
    expect(
      MARKETING_CONNECTION_LEDGER_ROWS.map((row) => `${row.id}:${row.state}`),
    ).toEqual([
      "youtube-public-research:verified",
      "google-ads-transparency-center:verified",
      "youtube-account-connection:implemented-not-connected",
      "meta-ad-library:candidate",
      "tiktok-content-posting:candidate",
    ]);
    // 台账签署日期与 MARKETING-DATA-SOURCES.md 的 Last updated 一致。
    expect(MARKETING_CONNECTION_LEDGER_AS_OF).toBe("2026-10-29");
  });

  it("已核验行的说明包含台账证据日期；账号行明确陈述“未连接”", () => {
    const byId = new Map(MARKETING_CONNECTION_LEDGER_ROWS.map((row) => [row.id, row]));
    expect(enUS["settings.marketingConnections.youtubePublic.detail"]).toContain(
      "verified 2026-10-28",
    );
    expect(enUS["settings.marketingConnections.googleAtc.detail"]).toContain(
      "verified 2026-10-29",
    );
    expect(enUS["settings.marketingConnections.youtubeAccount.detail"]).toContain(
      "not connected",
    );
    // 双语一致：中文侧同样不出现“已连接”的账号表述。
    expect(zhCN["settings.marketingConnections.youtubeAccount.detail"]).toContain("未连接");
    expect(byId.get("youtube-account-connection")?.state).toBe("implemented-not-connected");
  });

  it("三种状态徽标文案都不冒充连接状态", () => {
    expect(enUS[MARKETING_CONNECTION_STATE_BADGE_IDS.verified]).toBe("Verified");
    expect(enUS[MARKETING_CONNECTION_STATE_BADGE_IDS["implemented-not-connected"]]).toBe(
      "Not connected",
    );
    expect(enUS[MARKETING_CONNECTION_STATE_BADGE_IDS.candidate]).toBe("Candidate");
    // 徽标 key 在两个 locale 都有真源，不会渲染出裸 key。
    for (const state of ["verified", "implemented-not-connected", "candidate"] as const) {
      expect(zhCN[MARKETING_CONNECTION_STATE_BADGE_IDS[state]]).toBeTruthy();
    }
  });

  it("permission 规则行逐字保留原型的诚实规则", () => {
    expect(enUS["settings.marketingConnections.permissionRule"]).toBe(
      "Research, analytics, publishing and paid-ad account permissions remain distinct. No source is labelled verified until actual data is observed.",
    );
    expect(zhCN["settings.marketingConnections.permissionRule"]).toContain("不会被标注为已核验");
  });
});
