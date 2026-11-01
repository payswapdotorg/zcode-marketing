# MOS acceptance battery (MOS-INTAKE.md §11) — status 2026-11-01 (reconstruction run)

| AT | Result | Evidence |
| --- | --- | --- |
| AT-MOS-1 identity matrix | ✅ closed | desktopProductIdentity 15 tests (5 new MOS cases) + shared productIdentity 4 tests |
| AT-MOS-2 packaging config | ✅ closed | 2026-11-01-mos-packaging-dryrun.txt + 4/4 unit gate |
| AT-MOS-3 renderer branding | ✅ closed (unit/grep face) | unit battery; grep: every literal "MOS" in app source sits inside flavor-gated modules (mos-product-flavor/, productIdentity, gated config branches); sole non-gated hit is "TOPMOST" substring in windowsCuaOperationIndicator.ts (false positive) |
| AT-MOS-4 composer discovery | ✅ data face / e2e pending CI | 4 unit tests (prompt-only, prefill, no session); e2e spec committed, environment-limited |
| AT-MOS-5 task/project semantics | ✅ data face | semantics documented in MOS-INTAKE §4 rows 6–9; machinery is existing project-sidebar suites (regression green) |
| AT-MOS-6 real terminal | ⚠️ environment-limited | renderer+bridge proven via direct Electron probe (first session); wdio harness cannot complete here; spec committed for CI |
| AT-MOS-7 automations | ✅ data face | 4 template tests + catalog merge semantics; creation path is existing automation machinery (regression suites green) |
| AT-MOS-8 marketplace | ✅ data face / e2e pending CI | card render gated by compile-time flavor; no auto-install by construction |
| AT-MOS-9 marketing connections | ✅ closed (render input ↔ ledger) | marketingConnectionsData tests: 2 verified, 1 not-connected, 2 candidates, as-of 2026-10-29 |
| AT-MOS-10 Current State | ✅ data face / e2e pending CI | AboutMosSection renders only compile-time/runtime constants; "not configured" update status by construction |
| AT-MOS-11 default-build preservation | ✅ closed (this sandbox's scope) | architecture/lint/schema green; typecheck subset green (per-project); full root chain + full unit suite remain CI-authoritative (sandbox OOM) |
| AT-MOS-12 e2e battery | ⚠️ environment-limited | 2026-11-01-mos-e2e-environment-record.txt; spec committed: test/e2e/ui-shell/mos-product-flavor.test.ts |

D-MOS-1: implemented as Option A (build flavor), opt-in via ZCODE_MOS_IDENTITY=1; ratification still PENDING — default builds unchanged.
