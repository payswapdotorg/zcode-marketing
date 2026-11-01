# MOS-RELEASE-CHANNEL — MOS 安装包构建与发布渠道规程

> MOS（The Marketing OS）产品身份的打包/发布操作规程（`MOS-INTAKE.md` §8 MOS-06）。Status: procedure recorded; **publication deferred** — no MOS installer has been published, and none may be until D-MOS-1 is ratified by the TL and a release channel is created. Last updated: 2026-11-01.

## 1. 身份开关与两条轴（既有语义，MOS 沿用）

MOS 身份由构建期环境变量 `ZCODE_MOS_IDENTITY=1` 显式取得（严格拼写：`1` 开 / `0` 或空 关 / 其它值构建期失败），与 Preview 完全同构：

- **身份轴**：`ZCODE_MOS_IDENTITY=1` → flavor `marketing` → `productName: "MOS"`、`appId: dev.zcode.app.mos`、Linux 可执行名/系统包名 `mos`；与 `ZCODE_PREVIEW_IDENTITY=1` 互斥（同时开启构建期失败）。
- **后端轴**：`ZCODE_ENV=test|production` 独立决定产物后缀（测试后端加 `_TEST`）与后端连接，身份轴不干预。
- 默认（不设开关）行为与历史完全一致：正式 `ZCode` / 测试后端 `ZCode Preview`。

## 2. 构建命令（已由 AT-MOS-2 dry-run 验证配置面）

```bash
# 生产后端的 MOS 包（无 _TEST 后缀；与正式 ZCode 及 ZCode Preview 并排安装）
ZCODE_ENV=production ZCODE_MOS_IDENTITY=1 pnpm --filter @zcode/desktop build   # 按仓库现行打包入口

# 测试后端的 MOS 包（产物名带 _TEST）
ZCODE_ENV=test ZCODE_MOS_IDENTITY=1 pnpm --filter @zcode/desktop build
```

产物命名（`packages/desktop/electron-builder.config.js`）：`MOS-<version>-<platform>-<arch>[_TEST].<ext>`；Linux 系统包（deb/rpm/pacman）包名 `mos`，AppImage 可执行名 `mos`。Windows AUMID 复用 `dev.zcode.app.mos`（`resolveWindowsAppUserModelIdForFlavor`）。

## 3. 发布渠道规则（TL 批准前的硬约束）

1. **不发布。** D-MOS-1 批准（TL sign-off）之前，任何 MOS 安装包不得进入任何公开下载渠道；本地/CI 产物只作为验证证据归档。
2. **渠道标签。** 批准后首个渠道为 `preview`（Current State 视图如实渲染 "preview (pre-ratification build)" 直到批准并建立渠道；届时同步更新 `packages/ui/src/mos-product-flavor/AboutMosSection.tsx` 的渠道行与 `settings.aboutMOS.*` 文案）。
3. **更新状态。** MOS 没有独立更新服务器之前，应用内更新入口保持禁用，Current State 的更新状态渲染 "not configured"。
4. **校验和。** 任何对外分发的 MOS 产物必须随附 SHA-256 校验和（与正式 ZCode 发布同一要求）；发布记录写入 `docs/marketing/evidence/`。
5. **签名。** macOS：`ZCODE_ENABLE_MAC_SIGN=1` 时非 production flavor（含 MOS）必须提供签名身份，否则构建期失败（`electron-builder.config.js` 的守卫）；Windows/Linux 签名随正式发布链路，不因 MOS 绕过。
6. **许可保持。** MOS 是本 fork 的产品身份，不是再许可：`LICENSE` / `NOTICE.md` / `THIRD-PARTY-NOTICES.md` 原样随包分发；About 版权行保留 ZCode 归属。

## 4. 验证记录

- AT-MOS-2（打包 dry-run）：`packages/desktop/test/desktopMosPackagingIdentity.test.ts` —— 真实导入构建配置的子进程 dry-run：marketing 身份全字段（productName/appId/可执行名/三系统包名/extraMetadata flavor）+ 后端轴 `_TEST` 语义 + 默认身份对照。已在本沙箱全绿；CI unit 门随根套件执行。
