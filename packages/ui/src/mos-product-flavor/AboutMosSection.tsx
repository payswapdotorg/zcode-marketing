/**
 * MOS "About MOS" 设置分区 = Current State 视图（docs/marketing/MOS-INTAKE.md §8 MOS-06）。
 * 只渲染真实运行时值：产品身份、基础运行时与其版本、构建期嵌入的源修订号与构建时间、
 * 后端环境、发布渠道状态、平台、更新状态。禁止任何可能被误读为真实数据的占位值 ——
 * 未配置就显示“未配置”（MOS 没有、也不假装有更新通道，直到 TL 批准并建立发布渠道）。
 */
import {
  ZCODE_BUILD_TIME,
  ZCODE_COMMIT,
  ZCODE_ENV,
  ZCODE_PRODUCT_IDENTITY,
  ZCODE_VERSION,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";

interface CurrentStateRow {
  /** i18n key：行标签。 */
  labelId: string;
  /** 行值；所有值都来自编译期常量或运行时接口，不设占位文案。 */
  value: string;
  /** 长值（提交号/时间戳）用等宽渲染。 */
  mono?: boolean;
}

function resolveRuntimePlatform(): string {
  const platform = navigator.platform;
  return platform && platform.trim().length > 0 ? platform : "unknown";
}

export function resolveMosCurrentStateRows(
  platform: string = resolveRuntimePlatform(),
): CurrentStateRow[] {
  return [
    {
      labelId: "settings.aboutMOS.row.product",
      value:
        ZCODE_PRODUCT_IDENTITY.tagline === null
          ? ZCODE_PRODUCT_IDENTITY.productName
          : `${ZCODE_PRODUCT_IDENTITY.productName} · ${ZCODE_PRODUCT_IDENTITY.tagline}`,
    },
    {
      labelId: "settings.aboutMOS.row.baseRuntime",
      value: `ZCode Desktop ${ZCODE_VERSION}`,
    },
    { labelId: "settings.aboutMOS.row.sourceRevision", value: ZCODE_COMMIT, mono: true },
    { labelId: "settings.aboutMOS.row.buildTime", value: ZCODE_BUILD_TIME, mono: true },
    {
      labelId: "settings.aboutMOS.row.backendEnv",
      value: ZCODE_ENV,
    },
    {
      labelId: "settings.aboutMOS.row.channel",
      // 渠道状态如实陈述：D-MOS-1 批准之前，MOS 身份只能来自显式构建开关，没有发布渠道。
      value: "preview (pre-ratification build)",
    },
    { labelId: "settings.aboutMOS.row.platform", value: platform },
  ];
}

export function AboutMosSection() {
  const { intl } = useZCodeIntl();
  const rows = resolveMosCurrentStateRows();
  return (
    <div className="min-w-0 space-y-6" data-testid="settings-about-mos">
      <SettingsGroupCard>
        {rows.map((row) => (
          <div key={row.labelId} className="border-t border-border px-4 py-3 first:border-t-0">
            <div className="flex items-center justify-between gap-4">
              <div className="shrink-0 text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: row.labelId })}
              </div>
              <div
                className={row.mono ? "font-mono text-ui-base text-foreground-subtle" : "text-ui-base text-foreground-subtle"}
                data-about-mos-row-value={row.labelId}
              >
                {row.value}
              </div>
            </div>
          </div>
        ))}
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="shrink-0 text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.aboutMOS.row.updateStatus" })}
            </div>
            <div className="text-right text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.aboutMOS.update.notConfigured" })}
            </div>
          </div>
        </div>
      </SettingsGroupCard>
      <p className="px-1 text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.aboutMOS.note" })}
      </p>
    </div>
  );
}
