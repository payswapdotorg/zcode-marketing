/**
 * MOS 插件商店里的 "Marketing OS capabilities" 说明卡（docs/marketing/MOS-INTAKE.md §4 行 13 / §8 MOS-05）。
 * 原型把四组营销能力当作商店分区展示；真实实现里这些能力随内置 marketing 插件交付，
 * 由既有 ZCode agent 运行时调用 —— 本卡片如实说明这一点，不伪造四条可安装的商店条目，
 * 也不自动安装任何东西；启用/停用与权限管理仍在原生插件管理里。
 */
import { Megaphone } from "lucide-react";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const MARKETING_CAPABILITY_IDS = [
  "marketIntelligence",
  "creativeIntelligence",
  "experimentLearning",
  "publishingAnalytics",
] as const;

/** 编译期 flavor 判定导出为常量，默认构建整卡折叠（不渲染任何 MOS 文案）。 */
export const shouldRenderMarketingCapabilitiesCard = ZCODE_PRODUCT_FLAVOR === "marketing";

export function MarketingCapabilitiesCard() {
  const { intl } = useZCodeIntl();
  if (!shouldRenderMarketingCapabilitiesCard) return null;
  return (
    <section
      data-testid="plugin-store-marketing-capabilities"
      className="rounded-xl border border-border bg-card px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Megaphone aria-hidden="true" className="size-4 text-foreground-subtle" />
        <h3 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.pluginStore.marketing.title" })}
        </h3>
      </div>
      <p className="mt-2 text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.pluginStore.marketing.body" })}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {MARKETING_CAPABILITY_IDS.map((capability) => (
          <li
            key={capability}
            className="rounded-md bg-surface px-2.5 py-1 text-ui-base text-foreground-subtle"
          >
            {intl.formatMessage({ id: `settings.pluginStore.marketing.capability.${capability}` })}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-ui-base leading-6 text-foreground-subtlest">
        {intl.formatMessage({ id: "settings.pluginStore.marketing.note" })}
      </p>
    </section>
  );
}
