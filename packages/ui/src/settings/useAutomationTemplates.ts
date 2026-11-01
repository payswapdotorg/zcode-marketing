import { useEffect, useMemo } from "react";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { isValidCronExpr, type IClientScenesService } from "@zcode/services";
import {
  isClientScenesBusinessError,
  useClientScenesResource,
} from "@/hooks/useClientScenesResource.js";
import { logger } from "@/logger.js";
import {
  mapClientScenesToAutomationTemplates,
  type AutomationTemplateCatalog,
} from "@/settings/automationTemplateCatalog.js";
import { withMarketingScheduledTemplates } from "@/mos-product-flavor/index.js";

export type AutomationTemplateCatalogState = AutomationTemplateCatalog & {
  loading: boolean;
};

export function useAutomationTemplates(
  clientScenesService: IClientScenesService,
): AutomationTemplateCatalogState {
  const { scenes, loading, error } = useClientScenesResource(clientScenesService);
  const catalog = useMemo(
    // marketing flavor（MOS）在定时模板列表最前注入本地营销模板（MOS-05）；
    // 注入与既有映射走同一套 cron 校验语义，无法安全编辑的进 rejected 列表。
    () =>
      withMarketingScheduledTemplates(
        mapClientScenesToAutomationTemplates(scenes, isValidCronExpr),
        ZCODE_PRODUCT_FLAVOR,
        isValidCronExpr,
      ),
    [scenes],
  );

  useEffect(() => {
    if (!error) return;
    if (isClientScenesBusinessError(error)) {
      logger.warn("[automation-templates] Client Scenes 返回失败，保留手动创建入口", {
        code: error.code,
        message: error.responseMessage,
      });
      return;
    }
    logger.warn("[automation-templates] Client Scenes 请求失败，保留手动创建入口", {
      error: error.message,
    });
  }, [error]);

  useEffect(() => {
    if (catalog.rejectedScheduledTemplateIds.length === 0) return;
    logger.warn("[automation-templates] 已拒绝标题为空或调度无法安全编辑的定时模板", {
      templateIds: catalog.rejectedScheduledTemplateIds,
    });
  }, [catalog.rejectedScheduledTemplateIds]);

  return {
    ...catalog,
    loading,
  };
}
