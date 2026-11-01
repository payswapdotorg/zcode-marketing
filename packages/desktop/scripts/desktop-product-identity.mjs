/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `ZCODE_ENV` 单独决定。
 * 典型用法是 `ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `ZCode Preview`。
 */
export const ZCODE_PREVIEW_IDENTITY_ENV = "ZCODE_PREVIEW_IDENTITY";

/**
 * 构建期开关：为真时安装包使用 MOS（The Marketing OS）身份（docs/marketing/MOS-INTAKE.md，
 * D-MOS-1 选项 A：产品身份走构建期 flavor，而不是代码分叉）。语义与 Preview 开关完全同构：
 * 严格 `1` / `0` 拼写、与 `ZCODE_ENV` 后端轴正交、显式身份优先于环境推导。
 * D-MOS-1 批准之前，MOS 只能通过该开关显式取得 —— 默认构建永远是 ZCode。
 */
export const ZCODE_MOS_IDENTITY_ENV = "ZCODE_MOS_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.zcode.app",
  productName: "ZCode",
  linuxExecutableName: "zcode",
  linuxPackageName: "zcode",
  cuaHelperInstallVariant: null,
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.zcode.app.preview",
  productName: "ZCode Preview",
  linuxExecutableName: "zcode-preview",
  linuxPackageName: "zcode-preview",
  cuaHelperInstallVariant: "preview",
});

const MARKETING_IDENTITY = Object.freeze({
  flavor: "marketing",
  appId: "dev.zcode.app.mos",
  productName: "MOS",
  linuxExecutableName: "mos",
  linuxPackageName: "mos",
  // MOS 不是运行时变体：CUA helper 沿用正式变体，只有打包身份独立。
  cuaHelperInstallVariant: null,
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
  marketing: MARKETING_IDENTITY,
});

function normalizeDesktopZCodeEnv(env) {
  return env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$ZCODE_PREVIEW_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
export function isPreviewIdentityRequested(env = process.env) {
  const value = env[ZCODE_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_PREVIEW_IDENTITY_ENV}=${env[ZCODE_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * MOS 开关沿用 Preview 的严格拼写纪律：只有 `1` 开启，`0` / 空关闭，其它拼写在构建期
 * 失败，避免 YAML 路由层的精确比较与脚本层的宽松解析再次分叉（Preview 已为此付过学费）。
 */
export function isMarketingIdentityRequested(env = process.env) {
  const value = env[ZCODE_MOS_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_MOS_IDENTITY_ENV}=${env[ZCODE_MOS_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * 产品身份（flavor）与后端环境（`ZCODE_ENV`）是两个轴：
 * - `ZCODE_ENV=test` 一律是 Preview，测试后端不能顶着正式 `ZCode` 身份覆盖用户的正式安装；
 * - `ZCODE_ENV=production` 默认是正式身份，显式 `ZCODE_PREVIEW_IDENTITY=1` 时改用 Preview 身份；
 * - 显式 `ZCODE_MOS_IDENTITY=1` 时改用 MOS 身份（marketing flavor），后端轴仍由 `ZCODE_ENV` 决定；
 * - 两个身份开关同时开启是配置错误，构建期直接失败 —— 一个安装包只能有一个产品身份。
 * 未知 `ZCODE_ENV` 继续按 test 处理，和共享层 normalizeZCodeEnv 的 fail-safe 默认值一致。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  const marketing = isMarketingIdentityRequested(env);
  const preview = isPreviewIdentityRequested(env);
  if (marketing && preview) {
    throw new Error(
      `${ZCODE_MOS_IDENTITY_ENV} and ${ZCODE_PREVIEW_IDENTITY_ENV} are mutually exclusive; a build carries exactly one product identity`,
    );
  }
  if (marketing) {
    return "marketing";
  }
  if (preview) {
    return "preview";
  }
  return normalizeDesktopZCodeEnv(env) === "production" ? "production" : "preview";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview 包靠 productName（`ZCode Preview-<version>-...`）与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopZCodeEnv(env) === "test" ? "_TEST" : "";
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态继续保留旧身份，
 * 避免本地调试快捷方式和正式/Preview 安装包互相污染。
 */
export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (runtime.isPackaged === false) {
    return "cn.aminer.zcode";
  }
  // flavor 缺失时回退正式身份，保证历史调用方（只认 production/preview）行为不变；
  // marketing flavor 必须拿到自己的 appId，否则 Windows 会把 MOS 快捷方式归到 ZCode 名下。
  return desktopProductIdentities[flavor === "preview" || flavor === "marketing" ? flavor : "production"].appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}
