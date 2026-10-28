# MARKETING-ARCHITECTURE-LOCK

> Authoritative architectural boundaries for the marketing domain layer. Violations block merge. Owned by the TL. Last updated: 2026-10-28 (W0/W1 baseline).

## The one architectural decision that matters most

**The existing ZCode runtime is the only execution engine.** The marketing domain layer adds capabilities around it through its existing extension points. It must never become a fork of the agent loop.

Concretely, preserved and reused as-is:

| Existing capability | Where it lives (upstream) | Marketing use |
| --- | --- | --- |
| Agent loop, tool execution, permissions | `apps/zcode-cli/packages/core`, `cli` | Executes every marketing workflow |
| Tool contract (inputSchema/outputSchema, read-only/destructive flags, side-effect scopes, timeouts, cancellation) | CLI tool registry; change chain spec `apps/zcode-cli/docs/design/v2/tool/00-tool-change-chain.md` | Marketing tools are registered exactly like any other tool |
| Model/provider registry and routing | `packages/provider`, `provider-node`, `model-option-map` | Capability-based model routing extends this registry; it does not replace its selection logic |
| Sessions, tasks, subagents | `packages/services/src/session`, CLI subagent machinery | Marketing "specialists" are logical capabilities invoked by the runtime, not six persistent agents |
| Persistence conventions | `packages/services/src/storage` (domain/app/adapters layering), sqlite-migrations | The marketing temporal store follows the same layering and migration rules |
| Plugin / MCP / skills / hooks extension points | `apps/zcode-cli/packages/*-plugin`, MCP docs (`docs/mcp-*.md`), `.agents/skills/`, `docs/hooks-runtime-contract.md` | Connectors, creative-tool adapters, and publishing adapters attach here |
| Desktop / web / terminal distribution | `packages/desktop`, `web`, `apps/zcode-cli/packages/tui` | Marketing UI ships inside existing surfaces; no parallel app |

## Boundaries (mandatory)

1. **No second runtime.** No new planner loop, no new conversation/session engine, no new subagent framework, no side-channel model invocation path. Any workflow the marketing layer defines is executed by the existing runtime through tools, tasks, and skills.
2. **No direct I/O from domain logic.** Per the CLI's external-I/O convergence rules, all network calls, file access, and subprocess execution live in adapters. Marketing domain code expresses intent only. This is also what makes connectors testable and policy-safe.
3. **Runtime-validatable contracts at boundaries.** Anything crossing a process, storage, network, plugin, tool-call, or LLM boundary is described with runtime-validatable schemas (zod, following existing repo convention), not TypeScript types alone.
4. **One owner per state.** The temporal data plane (observations, snapshots, experiments) is owned by `packages/marketing`. The agent runtime's session/task state stays untouched. No duplicate write paths.
5. **Capability-based routing only.** Model and tool selection goes through the extended capability registry (see `MARKETING-CAPABILITY-MAP.md`). No hardcoded "use model X for task Y" in business logic.
6. **Permissions are additive and scoped.** New tools declare side-effect scopes; organic publishing and paid advertising are separate permission domains. Retries must not silently duplicate posts; credentials never enter prompts, logs, or generated artifacts.
7. **Licensing preserved.** Upstream is Apache 2.0; keep `LICENSE`, `NOTICE.md`, `THIRD-PARTY-NOTICES.md` intact. The upstream NOTICE records that the Computer Use package is an **unavailable placeholder in this open-source distribution** — never assume native computer-control works. Browser Use and Computer Use are assessed separately.

## Where the marketing layer lives

```
docs/marketing/                      Governance (this file set — single source of truth)
packages/marketing/src/domain/       Canonical records, value objects, contracts (pure, zero I/O)
packages/marketing/src/app/          Temporal store, capability catalog, workflows, ports
packages/marketing/src/adapters/     Connector adapters, model adapters, persistence adapters
apps/zcode-cli/packages/marketing-plugin/   CLI plugin exposing marketing tools to the runtime (W3+)
```

`packages/marketing` is registered in `architecture-policy.yaml` as a managed module with layering `domain → app → adapters` (mirrors the `storage` module pattern). Public entrypoints are explicit; cross-package imports must use public entrypoints and existing path aliases only.

## Migration and change rules

- Spec-first: update the relevant governance doc before changing behavior (root `AGENTS.md` core principle). For marketing, "relevant spec" means this doc set plus `apps/zcode-cli/docs/design/v2/` when tools change.
- Every work order states the interfaces it owns (see `WORK-REGISTRY.md`). Two workers never own the same file simultaneously; shared contracts are TL-owned.
- Architecture checks must pass: `pnpm architecture:check --changed`, plus `pnpm typecheck` and `pnpm lint` with truthful reporting. Where an environment could not run a check, the limitation is recorded in the work order — never reported as passed.
- Forbidden: marketing imports reaching into runtime internals; UI calling repos directly; circular dependencies; capabilities bypassing the connector contract to call platforms ad hoc.

## Assessment note (recorded honestly)

The upstream `zcode-cua` (Computer Use) package exists in the open-source tree, but upstream `NOTICE.md` marks Computer Use as a placeholder that is not available in this distribution. Browser-related capabilities (`browser-use-plugin`) exist and are the only screen/web-adjacent automation baseline that may be referenced. Marketing connectors therefore target official APIs, permitted public transparency endpoints, and user-authorized OAuth flows — never interactive scraping of logged-in sessions as a data strategy.
