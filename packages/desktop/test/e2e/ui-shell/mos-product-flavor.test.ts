import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_LOGIN_TRIGGER,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_TASK_SETTINGS_BUTTON,
  TID_TERMINAL_TOGGLE,
  TID_V4_COMPOSER_INPUT,
  testId,
  TID_SETTINGS_SECTION_NAV,
} from "@zcode/shared/test-ids";
import { clearAppData, clickTestIdByDom } from "../helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "../helpers/v4-conversation.js";

/**
 * MOS（marketing flavor）产品化 E2E（docs/marketing/MOS-INTAKE.md §11）。
 * 运行前提：以 `ZCODE_MOS_IDENTITY=1` 触发的 E2E 构建（身份轴参与构建缓存指纹）。
 * 覆盖：AT-MOS-3 品牌徽标、AT-MOS-4 草稿发现入口、AT-MOS-6 真实 PTY 终端、
 * AT-MOS-9 台账驱动的 Marketing connections、AT-MOS-10 Current State、
 * AT-MOS-8 商店营销能力卡。只操作应用 UI 和本地 PTY，不发送模型请求。
 */
describe("MOS marketing flavor 产品化 E2E", () => {
  before(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("MOS-01: 标题栏徽标渲染 MOS 标记，徽标即侧栏 dock 开关", async () => {
    const toggle = await $('[data-testid="desktop-top-logo-sidebar-toggle"]');
    await toggle.waitForExist({ timeout: 20000 });
    const mark = await browser.execute(() => {
      const badge = document.querySelector(
        '[data-testid="desktop-top-logo-sidebar-toggle"] [data-desktop-logo-badge="true"]',
      );
      return badge === null
        ? null
        : {
            ariaLabel: badge.getAttribute("aria-label"),
            text: badge.textContent?.trim() ?? "",
          };
    });
    // marketing 构建下品牌徽标是字母标记 "M"（原型配色），不再是 ZCode 图形 Logo。
    expect(mark).not.toBeNull();
    expect(mark?.ariaLabel).toBe("MOS");
    expect(mark?.text).toBe("M");
  });

  it("MOS-02: 草稿页渲染诚实说明行与营销快启（点击即预填 prompt）", async () => {
    // 原型 task-note 逐字落地：营销能力是任务工具，不是独立工作区。
    const note = await $('[data-v4-draft-marketing-note="true"]');
    await note.waitForDisplayed({ timeout: 20000 });
    expect(await note.getText()).toContain("Marketing capabilities are task tools");

    // 快启只在编程模式（或开启主动推荐的办公模式）露出；切到编程模式。
    await switchToCodingMode();

    const expected = [
      ["mos-quickstart-market-opportunity-scan", "Market opportunity scan"],
      ["mos-quickstart-creative-brief", "Creative brief"],
      ["mos-quickstart-experiment-plan", "Experiment plan"],
    ] as const;
    for (const [id, label] of expected) {
      const chip = await $(`[data-draft-suggested-prompt="${id}"]`);
      await chip.waitForDisplayed({ timeout: 20000 });
      expect(await chip.getText()).toContain(label);
    }

    // 点击快启只是 prompt 预填（AT-MOS-4）：composer 收到完整 prompt，不创建会话。
    await $(`[data-draft-suggested-prompt="mos-quickstart-market-opportunity-scan"]`).click();
    const composer = await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`);
    await composer.waitForExist({ timeout: 10000 });
    await browser.waitUntil(
      async () => (await composer.getText()).includes("evidence-backed opportunities"),
      { timeout: 10000, timeoutMsg: "快启点击后 composer 未收到预填 prompt" },
    );
    await assertNoSessionStarted();
  });

  it("MOS-03: 真实 PTY 终端在 MOS 构建里执行命令并回显输出（AT-MOS-6）", async () => {
    await $(`[data-testid="${TID_TERMINAL_TOGGLE}"]`).click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            document.querySelector("[data-workspace-terminal-frame]")?.getBoundingClientRect()
              .height ?? 0,
        )) > 50,
      { timeout: 15000, timeoutMsg: "终端面板没有展开" },
    );

    const terminalInput = await $("#terminal .xterm-helper-textarea");
    await terminalInput.waitForExist({ timeout: 15000 });
    // xterm 的输入 textarea 位于负 z-index；点击可见终端后校验焦点（与 general-coding-mode 同法）。
    await $("#terminal .xterm-screen").click();
    await browser.waitUntil(async () => terminalInput.isFocused(), {
      timeout: 10000,
      timeoutMsg: "终端没有获得输入焦点",
    });
    await browser.keys("printf 'MOS_%s\\n' PTY_ALIVE");
    await browser.keys("Enter");
    try {
      await browser.waitUntil(
        async () =>
          browser.execute(() =>
            [...document.querySelectorAll("#terminal .xterm-rows > div")].some(
              (row) => row.textContent?.trim() === "MOS_PTY_ALIVE",
            ),
          ),
        { timeout: 20000, timeoutMsg: "真实 PTY 没有回显 MOS_PTY_ALIVE" },
      );
    } finally {
      const artifactDir = join(process.cwd(), ".e2e-artifacts", "mos-product-flavor");
      await mkdir(artifactDir, { recursive: true });
      await browser.saveScreenshot(join(artifactDir, "mos-terminal-pty.png"));
    }
  });

  it("MOS-04: Marketing connections 只渲染台账签署过的状态（AT-MOS-9）", async () => {
    await openSettingsSection("marketingConnections");
    const section = await $('[data-testid="settings-marketing-connections"]');
    await section.waitForDisplayed({ timeout: 15000 });
    const body = await section.getText();
    expect(body).toContain("YouTube public research");
    expect(body).toContain("Google Ads Transparency Center");
    expect(body).toContain("YouTube account connection (OAuth)");
    expect(body).toContain("Meta Ad Library API");
    // 诚实规则行（原型逐字）。
    expect(body).toContain("No source is labelled verified until actual data is observed");
    const states = await browser.execute(() =>
      [...document.querySelectorAll("[data-marketing-connection-state]")].map(
        (badge) => badge.getAttribute("data-marketing-connection-state"),
      ),
    );
    expect(states.filter((state) => state === "verified")).toHaveLength(2);
    expect(states.filter((state) => state === "implemented-not-connected")).toHaveLength(1);
    expect(states.filter((state) => state === "candidate")).toHaveLength(2);
    // 账号行不允许出现“已连接”语义。
    expect(body).toContain("Not connected");
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
  });

  it("MOS-05: About MOS = Current State，只渲染真实运行时值（AT-MOS-10）", async () => {
    await openSettingsSection("aboutMOS");
    const section = await $('[data-testid="settings-about-mos"]');
    await section.waitForDisplayed({ timeout: 15000 });
    const rows = await browser.execute(() =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-about-mos-row-value]")].map((row) => [
          row.getAttribute("data-about-mos-row-value"),
          row.textContent?.trim() ?? "",
        ]),
      ),
    );
    // 产品行是 MOS · The Marketing OS；基础运行时是 ZCode Desktop（品牌事实）。
    expect(rows["settings.aboutMOS.row.product"]).toBe("MOS · The Marketing OS");
    expect(rows["settings.aboutMOS.row.baseRuntime"]).toMatch(/^ZCode Desktop /);
    // 源修订号/构建时间来自编译期元数据（允许 honest "unknown"，但行必须存在）。
    expect(Object.keys(rows)).toContain("settings.aboutMOS.row.sourceRevision");
    expect(Object.keys(rows)).toContain("settings.aboutMOS.row.buildTime");
    // 更新状态在建立 MOS 发布渠道前如实显示“未配置”，不冒充 up-to-date。
    expect(await section.getText()).toContain("Not configured");
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
  });

  it("MOS-06: 插件商店渲染营销能力说明卡，不伪造可安装条目（AT-MOS-8）", async () => {
    const storeEntry = await $('[data-testid="plugin-store-sidebar-open"]');
    await storeEntry.waitForDisplayed({ timeout: 20000 });
    await storeEntry.click();
    const storeRoot = await $('[data-testid="plugin-store-root"]');
    await storeRoot.waitForDisplayed({ timeout: 30000 });
    const card = await $('[data-testid="plugin-store-marketing-capabilities"]');
    await card.waitForDisplayed({ timeout: 15000 });
    const cardText = await card.getText();
    for (const capability of [
      "Market Intelligence",
      "Creative Intelligence",
      "Experiment & Learning",
      "Publishing & Analytics",
    ]) {
      expect(cardText).toContain(capability);
    }
    // 说明卡不自动安装任何内容；文案如实声明。
    expect(cardText).toContain("Nothing is installed automatically");
  });
});

async function openSettingsSection(section: string) {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout: 20000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, section));
}

async function switchToCodingMode() {
  await browser.waitUntil(
    async () => !(await $('[data-slot="dropdown-menu-content"]').isExisting()),
    { timeout: 10000 },
  );
  // "Interface mode" 是头像（profile）下拉菜单里的子菜单项，必须先点开菜单，
  // 否则菜单项根本不在 DOM 里（与 general-coding-mode.test.ts 的 switchMode 同法）。
  await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).waitForDisplayed({ timeout: 20000 });
  await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).click();
  await clickMenuItem("Interface mode");
  await clickMenuItem("Coding mode", '[role="menuitemradio"]');
  await browser.keys("Escape");
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => localStorage.getItem("zcode-interface-mode"))) === "coding",
    { timeout: 10000, timeoutMsg: "界面模式没有切换到 coding" },
  );
  await browser.waitUntil(
    async () =>
      (await $(`[data-testid="${TID_TERMINAL_TOGGLE}"]`).isExisting()) === true,
    { timeout: 10000, timeoutMsg: "编程模式下终端开关未出现" },
  );
  await browser.waitUntil(
    async () =>
      (await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).getAttribute("aria-expanded")) ===
      "false",
    { timeout: 10000, timeoutMsg: "头像菜单没有关闭" },
  );
}

async function clickMenuItem(label: string, selector = '[role="menuitem"]') {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (query, text) => {
          const element = [...document.querySelectorAll<HTMLElement>(query)].find(
            (item) =>
              item.getBoundingClientRect().width > 0 && item.textContent?.trim() === text,
          );
          if (!element) return false;
          element.click();
          return true;
        },
        selector,
        label,
      ),
    { timeout: 15000, timeoutMsg: `未找到菜单项 ${label}` },
  );
}

async function assertNoSessionStarted() {
  // 快启预填不创建会话。注意 draft 态下 [data-testid^="v4-session"] 也有匹配
  // （pane + sr-only title 常驻渲染），"没有会话"的正确信号是 pane 的
  // data-session-id 仍为 "draft"（与 helpers/v4-conversation.ts 的判定一致）。
  const boundSessions = await browser.execute(() =>
    [...document.querySelectorAll('[data-testid^="v4-session-pane"]')]
      .map((pane) => pane.getAttribute("data-session-id") ?? "")
      .filter((sessionId) => sessionId !== "draft"),
  );
  expect(boundSessions).toHaveLength(0);
}
