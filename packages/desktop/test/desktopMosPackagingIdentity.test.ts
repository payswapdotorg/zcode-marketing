import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import desktopBuilderConfig from "../electron-builder.config.js";
import { resolveDesktopProductIdentity } from "../scripts/desktop-product-identity.mjs";

/**
 * MOS（marketing flavor）打包身份契约（docs/marketing/MOS-INTAKE.md §11 AT-MOS-2）：
 * electron-builder 配置完全由 desktopProductIdentity 参数化，因此 marketing 身份
 * 通过真实导入构建配置的子进程 dry-run 验证 —— MOS 产物名/appId/可执行名/系统包名
 * 全套换成 mos 命名空间，同时默认（ZCode）与后端轴（_TEST 后缀）语义保持不变。
 */
const BUILDER_CONFIG_URL = new URL("../electron-builder.config.js", import.meta.url).href;

interface BuilderConfigSummary {
  productName: string;
  appId: string;
  linuxExecutableName: string | null;
  rpmPackageName: string | null;
  debPackageName: string | null;
  pacmanPackageName: string | null;
  linuxArtifactName: string | null;
  extraMetadataFlavor: string | null;
}

function importBuilderConfigSummary(env: NodeJS.ProcessEnv): BuilderConfigSummary {
  const code = `import(${JSON.stringify(BUILDER_CONFIG_URL)}).then((module) => {
  const config = module.default;
  console.log(JSON.stringify({
    productName: config.productName,
    appId: config.appId,
    linuxExecutableName: config.linux?.executableName ?? null,
    rpmPackageName: config.rpm?.packageName ?? null,
    debPackageName: config.deb?.packageName ?? null,
    pacmanPackageName: config.pacman?.packageName ?? null,
    linuxArtifactName: config.linux?.artifactName ?? null,
    extraMetadataFlavor: config.extraMetadata?.zcodeProductFlavor ?? null,
  }));
}).catch((error) => {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
});`;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(String(stdout)) as BuilderConfigSummary;
}

/** 去掉身份轴变量后复制环境，保证对照组与实验组只差一个开关。 */
function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ZCODE_MOS_IDENTITY;
  delete env.ZCODE_PREVIEW_IDENTITY;
  delete env.ZCODE_ENV;
  return env;
}

describe("desktop MOS packaging identity (AT-MOS-2)", () => {
  it("构建配置的身份字段全部由 desktopProductIdentity 参数化", () => {
    // 该耦合成立时，下面的子进程 dry-run 才能代表真实打包身份。
    const identity = resolveDesktopProductIdentity();
    expect(desktopBuilderConfig.productName).toBe(identity.productName);
    expect(desktopBuilderConfig.appId).toBe(identity.appId);
    expect(desktopBuilderConfig.linux?.executableName).toBe(identity.linuxExecutableName);
    expect(desktopBuilderConfig.rpm?.packageName).toBe(identity.linuxPackageName);
    expect(desktopBuilderConfig.deb?.packageName).toBe(identity.linuxPackageName);
    expect(desktopBuilderConfig.pacman?.packageName).toBe(identity.linuxPackageName);
    expect(desktopBuilderConfig.extraMetadata?.zcodeProductFlavor).toBe(identity.flavor);
  });

  it("生产后端 + ZCODE_MOS_IDENTITY=1 dry-run：MOS 命名空间，无 _TEST 后缀", () => {
    const summary = importBuilderConfigSummary({
      ...baseEnv(),
      ZCODE_ENV: "production",
      ZCODE_MOS_IDENTITY: "1",
    });
    expect(summary).toMatchObject({
      productName: "MOS",
      appId: "dev.zcode.app.mos",
      linuxExecutableName: "mos",
      rpmPackageName: "mos",
      debPackageName: "mos",
      pacmanPackageName: "mos",
      extraMetadataFlavor: "marketing",
    });
    expect(summary.linuxArtifactName).toBe("${productName}-${version}-linux-${arch}.${ext}");
  });

  it("测试后端 + ZCODE_MOS_IDENTITY=1 dry-run：仍由后端轴打 _TEST 产物后缀", () => {
    const summary = importBuilderConfigSummary({
      ...baseEnv(),
      ZCODE_ENV: "test",
      ZCODE_MOS_IDENTITY: "1",
    });
    expect(summary.productName).toBe("MOS");
    expect(summary.linuxArtifactName).toBe(
      "${productName}-${version}-linux-${arch}_TEST.${ext}",
    );
  });

  it("生产后端对照 dry-run：默认身份仍是 ZCode，MOS 开关不改变默认行为", () => {
    const summary = importBuilderConfigSummary({
      ...baseEnv(),
      ZCODE_ENV: "production",
    });
    expect(summary).toMatchObject({
      productName: "ZCode",
      appId: "dev.zcode.app",
      linuxExecutableName: "zcode",
      rpmPackageName: "zcode",
      debPackageName: "zcode",
      pacmanPackageName: "zcode",
      extraMetadataFlavor: "production",
    });
    expect(summary.linuxArtifactName).toBe("${productName}-${version}-linux-${arch}.${ext}");
  });
});
