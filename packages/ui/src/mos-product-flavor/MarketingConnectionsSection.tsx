/**
 * MOS "Marketing connections" 设置分区（marketing flavor 专属，docs/marketing/MOS-INTAKE.md §8 MOS-05）。
 * 只渲染数据源台账（MARKETING-DATA-SOURCES.md）签署过的真实状态：
 * - 已核验的公开研究源（YouTube 公共有机数据、Google Ads Transparency Center）；
 * - 已实现但没有生产连接记录的账号通道（YouTube OAuth —— WO-P1 栈已落地，同意流未运行，就没有连接）；
 * - 候选/未核验源（Meta Ad Library、TikTok）。
 * 本分区不做实时连接探测，也不提供任何假装可用的“连接”按钮 —— 连接状态的所有者是
 * WO-P1 连接记录；任务内的实时状态由 marketing 插件的连接工具报告。
 */
import { ShieldCheck, CircleDashed, HelpCircle } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  MARKETING_CONNECTION_LEDGER_AS_OF,
  MARKETING_CONNECTION_LEDGER_ROWS,
  MARKETING_CONNECTION_STATE_BADGE_IDS,
  type MarketingConnectionState,
} from "@/mos-product-flavor/marketingConnectionsData.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { cn } from "@/components/lib/utils.js";

function stateBadgeClass(state: MarketingConnectionState): string {
  switch (state) {
    case "verified":
      return "bg-success-subtle text-success";
    case "implemented-not-connected":
      return "bg-surface text-foreground-subtle";
    case "candidate":
      return "bg-surface text-foreground-subtlest";
  }
}

function StateBadge({ state }: { state: MarketingConnectionState }) {
  const { intl } = useZCodeIntl();
  const Icon =
    state === "verified" ? ShieldCheck : state === "implemented-not-connected" ? CircleDashed : HelpCircle;
  return (
    <span
      data-marketing-connection-state={state}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-ui-base font-medium",
        stateBadgeClass(state),
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {intl.formatMessage({ id: MARKETING_CONNECTION_STATE_BADGE_IDS[state] })}
    </span>
  );
}

export function MarketingConnectionsSection() {
  const { intl } = useZCodeIntl();
  return (
    <div className="min-w-0 space-y-6" data-testid="settings-marketing-connections">
      <SettingsGroupCard>
        {MARKETING_CONNECTION_LEDGER_ROWS.map((row) => (
          <div key={row.id} className="border-t border-border px-4 py-3 first:border-t-0">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-ui-base font-medium text-foreground">
                  {intl.formatMessage({ id: row.labelId })}
                </div>
                <div className="mt-1 text-ui-base leading-6 text-foreground-subtle">
                  {intl.formatMessage({ id: row.detailId })}
                </div>
              </div>
              <StateBadge state={row.state} />
            </div>
          </div>
        ))}
      </SettingsGroupCard>
      <p className="px-1 text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage(
          { id: "settings.marketingConnections.note" },
          { asOf: MARKETING_CONNECTION_LEDGER_AS_OF },
        )}
      </p>
      <p className="px-1 text-ui-base leading-6 text-foreground-subtlest">
        {intl.formatMessage({ id: "settings.marketingConnections.permissionRule" })}
      </p>
    </div>
  );
}
