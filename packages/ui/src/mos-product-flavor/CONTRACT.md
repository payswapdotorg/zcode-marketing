# mos-product-flavor

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：MOS（marketing flavor）产品化在 ui 层的全部新增面（docs/marketing/MOS-INTAKE.md §8）。产品身份（flavor）本身由 `@zcode/shared` 的 `ZCODE_PRODUCT_FLAVOR`/`ZCODE_PRODUCT_IDENTITY` 携带；本模块不定义身份，只消费它。

不变量：

- 无状态：本模块不持有运行时数据、不发请求、不写存储。连接状态渲染数据源台账（`docs/marketing/MARKETING-DATA-SOURCES.md`）签署过的行；账号连接状态的唯一所有者是 WO-P1 连接记录，不是本模块。
- 默认构建不变：非 marketing flavor 下，合并函数恒等/原样返回，展示组件不被挂载（settingsPageConfig 与 PluginStorePage 的编译期 flavor 分支负责挂载），默认构建不出现任何 MOS 文案。
- prompt-only：快启/模板只是 prompt 与调度的预填；任务执行仍由既有 ZCode 运行时与 marketing 插件承担（架构锁第 1 条）。

交集 hook 点：`useDraftSuggestedPromptItems`（快启并入）、`useAutomationTemplates`（模板并入）、`SettingsPage`（两个设置分区挂载）、`PluginStorePage`（商店能力卡挂载）。
