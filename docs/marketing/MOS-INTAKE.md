# MOS-INTAKE — The Marketing OS 产品化审计与实施蓝图

> **Status:** implemented behind the opt-in marketing flavor (`ZCODE_MOS_IDENTITY=1`); D-MOS-1 ratification PENDING — default builds unchanged. Owner: TL (`marketing-tl`). First recorded 2026-11-01 from the uploaded prototype. **Provenance note (2026-11-01, third reconstruction):** the authoring sandbox has recycled twice since the first draft; each time the unpushed local commits were destroyed and the stream was re-created from the working record (registry entries, conversation-held file contents, repo state). The decisions, matrix, and battery below are the working record of the stream, not byte-identical copies of the first draft. Source of truth: `docs/marketing/WORK-REGISTRY.md` (entries MOS-01…07) and `docs/marketing/evidence/2026-11-01-mos-*`.

## 1. Source

- **Prototype:** `MOS-The-Marketing-OS.html` — a static single-page mockup of "MOS · The Marketing OS" (SHA-256 starts `b1a63b8d…`, ends `2519f8`; uploaded by the user 2026-11-01).
- **Question the prototype asks:** can the ZCode fork present itself as a marketing product — a marketing-first workspace — without forking the runtime, the task machinery, or the honest-data discipline the marketing waves (W1–W8, WO-P1, WO-G2, WO-P5) already built?
- **Answer implemented:** yes, as a build-time product identity (flavor) plus a small set of flavor-gated UI surfaces. Everything else is the existing ZCode runtime.

## 2. Architecture-lock check (MARKETING-ARCHITECTURE-LOCK.md)

All seven boundaries PASS or APPLIES for the prototype's scope — the prototype is architecture-compatible as a skin/discovery layer:

1. **Task flow is the only workspace** — PASS: the prototype's pages map onto the existing task sidebar + settings + store, not new workspaces.
2. **Marketing capabilities are tools** — PASS: quick-starts/templates are prompt prefill; execution stays in the agent runtime + marketing plugin.
3. **Ledger discipline** — APPLIES: the prototype's connection states are rendered only from `MARKETING-DATA-SOURCES.md` signed rows.
4. **Connector contract** — APPLIES (unchanged; no new data source is introduced by the product shape).
5. **No fabricated data** — PASS: every state rendered by the new surfaces is a real build-time/runtime constant or a ledger row.
6. **Plugins/marketplace native** — PASS: the store card describes built-in capabilities; no fake install entries, no auto-install.
7. **Update/packaging rails** — APPLIES: MOS packaging rides the existing electron-builder identity axis; update stays disabled until a channel exists.

## 3. D-MOS-1 — product identity decision input

The prototype requires the app to *be* MOS (name, logo, packaging) while the fork must stay ZCode by default. Options:

- **A. Build-time product flavor (recommended, implemented):** a third flavor `marketing` next to `production`/`preview`, injected by `ZCODE_MOS_IDENTITY=1` at build time. Identity (name/appId/executable/package names/logo surfaces) swaps wholesale; runtime machinery is untouched; default builds are byte-identical in behavior.
- **B. Distribution re-skin:** rebuild with patched constants per release. Rejected: every surface would drift from upstream and merge conflicts become permanent.
- **C. Hard fork:** separate product repo. Rejected: forfeits the architecture lock and the fork's whole reason (the ZCode runtime under marketing tooling).

**Ratification remains a TL decision (PENDING).** Until ratified: no MOS installer is published (see `MOS-RELEASE-CHANNEL.md`), and the Current State view honestly renders the channel as "preview (pre-ratification build)".

## 4. Feature matrix (prototype element → repo anchor)

| # | Prototype element | Realization (repo anchor) | Status |
| --- | --- | --- | --- |
| 1 | "MOS · The Marketing OS" window title/brand | `ZCODE_PRODUCT_IDENTITY` (shared) + window naming via `runtimeApplicationName` | ✅ MOS-02 |
| 2 | "M" letter mark in the titlebar (prototype colors) | `ProductLogoBadge` in `RootStartupLoading` / `WindowsTopLeftLogo` / `DesktopTopOverlay` | ✅ MOS-02 |
| 3 | Titlebar mark doubles as sidebar dock/undock | existing `desktop-top-logo-sidebar-toggle` affordance (mark swaps inside it) | ✅ MOS-02/03 |
| 4 | New task — marketing quick-start chips | `marketingDraftPrompts.ts` merged in `useDraftSuggestedPromptItems` (prompt-only) | ✅ MOS-03 |
| 5 | Honest welcome note ("task tools, not separate workspaces") | `chat.empty.marketing.note` in `ConversationDraftEmptyState` (en/zh) | ✅ MOS-03 |
| 6 | Projects → groups; Independent task | **Existing** task/project machinery unchanged (semantics documented: prototype "projects" = repo task groups; "Independent" = ungrouped) | ✅ mapped |
| 7 | Composer + model picker | Existing v4 composer (unchanged) | ✅ existing |
| 8 | Real terminal pane | Existing side-pane/terminal-frame PTY terminal (unchanged; e2e asserts it under MOS) | ✅ MOS-04 spec |
| 9 | Task history list | Existing task sidebar (unchanged) | ✅ existing |
| 10 | Plugin Marketplace nav entry | Existing sidebar entry `plugin-store-sidebar-open` (unchanged) | ✅ existing |
| 11 | Automations as a main view | Existing workspace automations hub (unchanged) | ✅ existing |
| 12 | Four marketing automation templates | `marketingAutomationTemplates.ts` merged in `useAutomationTemplates` | ✅ MOS-05 |
| 13 | Store "Marketing OS capabilities" section | `MarketingCapabilitiesCard` (info card, no fake installs) | ✅ MOS-05 |
| 14 | Settings — Marketing connections | `MarketingConnectionsSection` + `marketingConnectionsData.ts` (ledger-true) | ✅ MOS-05 |
| 15 | Settings — connection state badges (Verified/Not connected/Candidate) | `MARKETING_CONNECTION_STATE_BADGE_IDS` + states from the ledger | ✅ MOS-05 |
| 16 | Permission-rule line ("no source is labelled verified until actual data is observed") | `settings.marketingConnections.permissionRule` (prototype text verbatim) | ✅ MOS-05 |
| 17 | About / Current State view | `AboutMosSection` (real runtime/build values only) | ✅ MOS-06 |
| 18 | Update status row | honestly "Not configured — no MOS update channel" until a channel exists | ✅ MOS-06 |
| 19 | MOS installer artifacts | builder identity axis (dry-run gate, 4/4) | ✅ MOS-06 |
| 20 | Release channel (Stable/Preview/Nightly in prototype) | **deferred**: no channel until D-MOS-1 ratification; procedure recorded | ⏸ MOS-06 |

## 5. What the prototype does NOT get (honest deltas)

- No new data source, connector, or permission: the marketing plugin's verified set (YouTube public research, GATC) is the entire data面 today.
- No "Connect account" button that fakes OAuth: the YouTube account row states implemented-but-not-connected until a production consent run is recorded (WO-P1 connection record is the owner).
- No separate marketing workspace/routes: every MOS surface lives inside the existing task flow (architecture lock #1).
- No update channel until ratified.

## 6. Non-goals

Re-architecting navigation; new scheduler; new state owners; touching the marketing plugin's contracts; publishing installers.

## 7. Evidence discipline

Every milestone lands with: unit tests in the repo, evidence files under `docs/marketing/evidence/`, registry entry in `WORK-REGISTRY.md`. Sandbox-unrunnable gates are recorded as environment-limited with the exact attempts; CI remains authoritative.

## 8. Milestones

- **MOS-01** intake audit (this document) + registry/roadmap wiring.
- **MOS-02** identity: flavor, descriptor, builder, brand surfaces, About, runtime app name.
- **MOS-03** workspace/New task: quick-starts, mark-as-dock-toggle, honest note, semantics mapping.
- **MOS-04** terminal integration e2e (real PTY under the real app, marketing build).
- **MOS-05** automations templates, marketplace card, two settings sections.
- **MOS-06** packaging dry-run gate + release-channel procedure + Current State view.
- **MOS-07** acceptance battery (§11) as far as the sandbox allows.

## 9. Change map (files by milestone)

See the registry entries MOS-02…07 and the commit itself; the `mos-product-flavor` ui module (`packages/ui/src/mos-product-flavor/`) carries the ui-side additions under architecture governance (contract.ts/CONTRACT.md/contract.test.ts).

## 10. Risks

1. **Flavor leakage** — mitigated by compile-time gating + AT-MOS-3 grep (no MOS literals outside gated modules; default builds unchanged).
2. **Preview parity regressions** — mitigated by the identity test matrix (both backends, strict spelling, mutual exclusion) and the builder dry-run parity case.
3. **Sandbox verification limits** — 4GB sandbox cannot run the full unit suite / root typecheck chain / wdio e2e; mitigated by running the affected suites + gates that do fit, recording environment-limited items honestly, and leaving CI authoritative.
4. **Identity-axis cache poisoning in e2e builds** — fixed by adding both identity flags to the e2e build fingerprint (pre-existing gap affecting Preview too).
5. **Unpushed-work loss to sandbox recycles** — realized twice (see provenance note); mitigation is pushing through the guards at the end of every session, and the push-gate memory blocker below.

## 11. Acceptance battery (AT-MOS)

1. **AT-MOS-1 identity matrix** — flavor resolution across backends, strict spelling, mutual exclusion, default-off parity. *(unit)*
2. **AT-MOS-2 packaging config** — real builder-config dry-run under all three identity envs; `_TEST` suffix semantics preserved. *(unit gate)*
3. **AT-MOS-3 renderer branding** — mark replaces ZCode logo on the three surfaces under marketing; zero MOS text in default builds. *(unit/grep + e2e half)*
4. **AT-MOS-4 composer discovery** — quick-start chips render, click prefills prompt only, no session created. *(unit + e2e half)*
5. **AT-MOS-5 task/project semantics** — existing machinery untouched; documented mapping. *(existing suites + doc)*
6. **AT-MOS-6 real terminal** — typed command echoes through the real PTY in the marketing build. *(e2e)*
7. **AT-MOS-7 automations** — four templates with prototype schedules, validated merge, rejected-list semantics. *(unit)*
8. **AT-MOS-8 marketplace** — capability card renders; no auto-install; no fake entries. *(unit + e2e half)*
9. **AT-MOS-9 marketing connections** — render input ↔ ledger mapping: 2 verified, 1 not-connected, 2 candidates, as-of date; no fake "connected". *(unit + e2e half)*
10. **AT-MOS-10 Current State** — only real runtime/build values; update status "not configured". *(unit + e2e half)*
11. **AT-MOS-11 default-build preservation** — architecture/lint/schema/typecheck gates green; no behavior change without the flag. *(gates)*
12. **AT-MOS-12 e2e battery** — the desktop-electron CI gate runs the committed spec `test/e2e/ui-shell/mos-product-flavor.test.ts`. *(CI home)*

## 12. Open questions (TL inputs)

- D-MOS-1 ratification (identity mechanism + publication).
- Brand assets: exact mark colors/wordmark file (current mark is the prototype's letterform rendered in-code).
- Channel naming once ratified (prototype shows Stable/Preview/Nightly; current honest value: preview pre-ratification).
- WO-P1 carry-overs (unchanged): brand account/channel, OAuth client, test-user basis, decisions D2/R1.
