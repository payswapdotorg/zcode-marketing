import { useEffect, useMemo } from "react";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import type { IClientScenesService } from "@zcode/services";
import {
  isClientScenesBusinessError,
  useClientScenesResource,
} from "@/hooks/useClientScenesResource.js";
import { logger } from "@/logger.js";
import {
  mapClientScenesToDraftSuggestedPromptItems,
  type DraftSuggestedPromptItem,
} from "@/v4/draftSuggestedPromptItems.js";
import { withMarketingQuickStartPrompts } from "@/mos-product-flavor/index.js";

export function useDraftSuggestedPromptItems({
  clientScenesService,
  rpcReady,
  workspaceKey,
}: {
  clientScenesService: IClientScenesService;
  rpcReady: boolean;
  workspaceKey: string;
}): DraftSuggestedPromptItem[] {
  const clientScenes = useClientScenesResource(clientScenesService, {
    enabled: rpcReady,
  });

  useEffect(() => {
    const error = clientScenes.error;
    if (!error) return;
    if (isClientScenesBusinessError(error)) {
      logger.warn("[v4-suggested-prompts] Client scenes 返回失败，推荐列表保持为空", {
        code: error.code,
        message: error.responseMessage,
        workspaceKey,
      });
      return;
    }
    logger.warn("[v4-suggested-prompts] Client scenes 请求失败，推荐列表保持为空", {
      error: error.message,
      workspaceKey,
    });
  }, [clientScenes.error, workspaceKey]);

  return useMemo(
    // marketing flavor（MOS）把三条营销快启并入推荐列表最前（MOS-03，prompt-only）；
    // Client Scenes 不可用时本地快启仍然出现 —— rpc 未就绪不是隐藏任务入口的理由。
    () =>
      withMarketingQuickStartPrompts(
        mapClientScenesToDraftSuggestedPromptItems(clientScenes.scenes),
        ZCODE_PRODUCT_FLAVOR,
      ),
    [clientScenes.scenes],
  );
}
