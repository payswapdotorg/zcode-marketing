# FEATURE-PRESERVATION-MATRIX

> Existing ZCode features that must keep working, regression coverage, and known upstream limitations. The marketing layer is additive; anything in this matrix breaking blocks release. Owned by the TL. Baseline recorded: 2026-10-28 (W0, fork point = upstream main `3c5b2276`, tag v3.15.1 history).

## Fork baseline

- Upstream: `zai-org/zcode` @ `3c5b2276` ("chore: sync ZCode source", v3.16.2 era), tags `v3.14.3`, `v3.15.1`, branches `main`, `feat/ui-plugin`.
- License: Apache 2.0 (`LICENSE`), attribution and notices (`NOTICE.md`, `THIRD-PARTY-NOTICES.md`) preserved as-is in this fork. New integrations must be reviewed for separate third-party terms before adoption.

## Preservation matrix

| Upstream capability | Where | Regression coverage | Marketing interaction | Must remain intact |
| --- | --- | --- | --- | --- |
| Agent loop, tool execution, permissions | `apps/zcode-cli/packages/core`, `cli` | Upstream CLI test suites (`apps/zcode-cli/tests`, e2e) | Marketing tools register into this chain | ✅ unchanged; only additive tool registrations |
| Tool change chain (schema → permission → execution → events → UI projection) | `apps/zcode-cli/docs/design/v2/tool/00-tool-change-chain.md` | Spec conformance + affected tests | Marketing tools must follow the same chain end-to-end | ✅ |
| Provider/model registry & routing | `packages/provider`, `provider-node`, `model-option-map` | Upstream unit tests | Capability metadata extension only | ✅ no selection-logic changes |
| Sessions, tasks, subagents, task lists | `packages/services/src/session` | Upstream suites; pre-push affected UTs | Runtime invokes marketing workflows through them | ✅ |
| Desktop app (Electron main/host/renderer, stdio agent protocol) | `packages/desktop`, `packages/shared/src/zcode-protocol` | Desktop E2E (`Dockerfile.desktop-e2e`, webdriverio) | Marketing UI surfaces mount in existing windows | ✅ |
| Web client & server, RPC framework | `packages/web`, `server`, `rpc` | Upstream web tests | Marketing views served by existing surfaces | ✅ |
| Terminal UI (tui) | `apps/zcode-cli/packages/tui` | CLI tests | Marketing tools usable from terminal | ✅ |
| Plugin system (store, marketplace, lifecycle, UI plugins) | CLI plugin packages; `CONTEXT.md` vocabulary | Plugin lifecycle case catalogs | Marketing ships as a plugin; no parallel install mechanism | ✅ |
| MCP support (stdio/OAuth/async catalog) | `docs/mcp-*.md`, runtime MCP | MCP test servers | Connectors may expose/consume MCP where appropriate | ✅ |
| Skills & hooks | `.agents/skills/`, `docs/hooks-runtime-contract.md` | Upstream skill/hook tests | Marketing workflows delivered as skills where fitting | ✅ |
| Browser Use | `apps/zcode-cli/packages/browser-use-plugin`, `docs/browser-use/` | Upstream browser-use tests | Permitted public-transparency collection only | ✅ |
| Storage layering (domain/app/adapters) & sqlite migrations | `packages/services/src/storage`, `packages/shared/src/sqlite-migrations` | Migration contract checks (`scripts/check-sqlite-schema.ts`) | `packages/marketing` mirrors the same layering | ✅ |
| Remote control, relay, workspace identity, permissions | `docs/web-remote-control*`, `docs/permission-project-approval.md` | Upstream suites | Untouched by marketing | ✅ |
| Build, release, CI | `scripts/`, `docs/ci/` | CI suites | New package must pass existing gates (`pnpm typecheck`, `lint`, `architecture:check --changed`, `verify:pre-push`) | ✅ additive only |

## Known upstream limitations (must not be assumed away)

- **Computer Use is a placeholder**: the upstream `NOTICE.md` records that the Computer Use package is **unavailable in this open-source distribution**. Browser Use and Computer Use are assessed separately; marketing connectors must not assume native computer control works.
- **Plugin-store vocabulary is governed by `CONTEXT.md`** — marketing docs must not reuse terms like "Official Marketplace/Featured/Recommended" for marketing concepts.
- Existing `marketing-touch-*` docs/scripts in upstream refer to **product analytics touchpoints** — an unrelated domain. The marketing intelligence layer must not collide with those identifiers (hence `docs/marketing/` area and `marketing.` tool prefixes with domain-scoped tests).
- Single-file size cap (800 lines) and Chinese-comment conventions for bugfixes apply to all new code (root `AGENTS.md`).

## Regression protocol for this fork

1. Before merging any marketing change: run `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check --changed`, `pnpm verify:pre-push` (affected UTs) in a full environment; record results truthfully in the work order.
2. Full suites (`pnpm test`) per upstream rules — only when explicitly requested; affected-selection is the default.
3. Environment-limited runs must state exactly what ran and what could not — never imply a pass that did not happen (this row is required in every WORK-REGISTRY entry).
4. Upstream sync policy: re-sync from `zai-org/zcode` is a TL decision; after any sync, re-run the preservation matrix audit and update this file before marketing work continues on top.
