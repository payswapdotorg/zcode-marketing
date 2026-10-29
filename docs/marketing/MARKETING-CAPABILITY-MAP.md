# MARKETING-CAPABILITY-MAP

> How research, analysis, creative, publishing, and learning capabilities map onto the existing ZCode runtime and its extension points. Owned by the TL. Last updated: 2026-10-29 (W3-3: the sampling bridge is verified through the REAL host provider registry — production path closed).

## Principle

Marketing "specialists" are **logical responsibilities, not persistent agents**. The existing runtime decides which capabilities to invoke, which run concurrently, which need more evidence, and which model is appropriate for each task. The marketing layer provides: a capability catalog, structured artifacts, workflow definitions, and routing rules.

## Specialist capabilities

| Capability (logical) | Responsibility | Output artifacts (see MARKETING-DATA-MODEL.md) | Runtime home |
| --- | --- | --- | --- |
| Product & market researcher | Product description/landing page/offer/objective → product profile; competitor candidates with relevance and confidence; buyer problems, differentiators, audience segments | `ProductBrief`, `MarketMap`, `CompetitorCandidate` | Marketing tool `marketing.research.product` → domain workflow |
| Ad intelligence researcher | Query eligible ad libraries, resolve advertiser identities, dedupe creatives, track observable ad history and variations | `Advertiser`, `AdCreative`, `AdObservation`, `CoverageReport` | Marketing tool `marketing.research.ads` → connector adapters |
| Organic content researcher | Find relevant platform content, topic clusters and formats, comparable performance within matched observation windows | `ContentObservation`, `TopicCluster`, `PerformanceSignal` | Marketing tool `marketing.research.organic` → connector adapters |
| Creative intelligence analyst | Multimodal analysis of video/image/audio/captions/transcripts; extract creative structure (not a summary of what a post depicts) | `CreativeFeatureSet`, `HookPattern`, `StoryStructure`, `EvidenceReference` | Marketing tool `marketing.analyze.creative` → multimodal model routing |
| Cross-source strategy analyst | Paid × organic intersection, ranked opportunities, contradictions, original creative experiments | `CreativeHypothesis`, `EvidenceGraph`, `ExperimentPlan` | Marketing tool `marketing.synthesize.strategy` |
| Publishing & learning operator | Validate asset, request approval, publish via authorized integration, gather observations, recommend next experiment | `CreativeArtifact`, `PublicationRecord`, `ExperimentResult`, `NextAction` | Marketing tools `marketing.publish.*`, `marketing.measure.*` |

## Capability-based routing (extends the existing registry)

Build on the existing provider/model registry in `packages/provider` and `model-option-map`; extend with marketing-relevant capability metadata rather than replacing selection logic. For every model or tool the system records, when supported:

- Can perform: web research, structured extraction, text reasoning, vision, audio/video understanding, image generation, other.
- Associated connectors: which platforms, API scopes, operations are available.
- Approximate cost, latency, context limits, reliability for the task class.
- Whether it can invoke tools, emit constrained structured output, and support the required workflow.

Routing rule: **cheapest suitable capability that meets quality and reliability requirements**, fallback to another eligible provider when necessary, and always record what was used (EvidenceRecord). The router never assumes one model is best at every stage. Example assignments: a low-cost text model classifies captions; a multimodal model analyzes creative assets; a retrieval tool establishes evidence; a stronger reasoning model synthesizes final strategy.

### Real-model bridge (W3-2): the MCP sampling channel

Structured extraction reaches a real model **through the host runtime only** — never a side-channel. The path, in order:

1. The marketing plugin (stdio MCP server) detects the host's declared `sampling` client capability after the MCP initialize handshake.
2. `McpSamplingModel` (plugin adapter, implements `ModelPort`) issues a `sampling/createMessage` request per task call, carrying a task profile (system prompt + strict JSON output contract + `modelPreferences` mapped from the task class: caption classification is cost/speed-prioritized, strategy synthesis is intelligence-prioritized).
3. The CLI host's MCP client (same pattern as the existing `elicitation/create` handler) validates the request with the shared sampling zod schema, attributes it to the server's active tool-call trace, and delegates to the runtime's existing `sampleModel` method — the one MCP UI apps already use — which resolves the session model **through the provider registry**, records model usage, and honors abort.
4. The response's `model` name plus the routing decision become the record's provenance (`extractionModelRef: "zcode:routed:<model>"`).

When the channel is unavailable (host without sampling, or a declined/failed request), the `FallbackModelPort` falls back to the labeled heuristic adapter and the fallback reason is stamped into the provenance (`"heuristic:* (fallback: …)"`) and visible in tool output — never silently substituted. The heuristic adapter is a labeled stand-in for test/demo wiring, not a competing production capability (per its own contract).

## Mapping to extension points (audited W0)

| Marketing need | ZCode extension point (verified present) | Notes |
| --- | --- | --- |
| Domain logic hosting | New managed workspace package `packages/marketing` (domain/app/adapters layering) | Registered in `architecture-policy.yaml` |
| Invoking capabilities from chat/agent | CLI plugin pattern (`apps/zcode-cli/packages/*-plugin`) + tool registry with inputSchema/outputSchema, permission scopes | Marketing tools follow the tool change chain spec |
| External platform APIs | Adapter layer in `packages/marketing/src/adapters` + I/O convergence rules; optional MCP servers (`docs/mcp-*.md`) for user-provided endpoints | All connectors implement `PLATFORM-CONNECTOR-CONTRACT.md` |
| Creative production tools (Higgsfield etc.) | Creative-tool adapter port; prompt pack is exportable/importable when no API exists | Separate adapters, never inside the intelligence workflow |
| Skills & domain workflows | `.agents/skills/` mechanism; `dynamic-workflow` / `dynamic-workflow-runtime` packages for workflow definitions | Workflows express orchestration; the runtime executes |
| Web evidence (permitted) | `browser-use-plugin` (exists) and web search tooling with domain allowlist (`docs/websearch-provider-domain-allowlist.md`) | Never a license to bypass platform controls |
| Persistence | Existing storage/sqlite conventions + marketing temporal store | Idempotent snapshots, as-of queries (MARKETING-DATA-MODEL.md) |
| UI surfaces | Existing plugin UI / dynamic Gen UI surfaces (`docs/plugin-ui-*.md`, `feat/ui-plugin` branch) | Marketing workspace views ship as plugin surfaces |

## Invocation flow (all inside the existing runtime)

1. A marketing mission (ProductBrief + goal) is submitted via a marketing tool.
2. The runtime assembles a plan from the capability catalog, workflows, and routing rules — using its existing task/subagent mechanisms for concurrency.
3. Each step invokes a marketing tool; the tool calls domain workflows in `packages/marketing`; workflows use ports (connectors, models) resolved through the capability registry.
4. Every step records provenance (EvidenceRecord) into the temporal store.
5. Gaps and uncertainties surface in the CoverageReport — never silently filled.

## Status of mapping (honest)

W0 audit confirmed the existence and location of the runtime pieces above from source inspection, and the full-environment gates have since been run and recorded (`evidence/2026-10-28-full-env-verification.txt`). The domain slice (W1/W2) proves the domain contracts, temporal semantics (in-memory AND SQLite persistence), and loop logic in `packages/marketing` with a sample connector plus one verified real connector (`connector:youtube-public`, keyless public organic routes). **Runtime execution is demonstrated (W3-1, 2026-10-28):** the official plugin `marketing` registers the mission tools on the CLI's stdio MCP plugin chain, and the full tool chain ran end-to-end through a real spawned server process (`evidence/2026-10-28-w3-plugin-chain-run.txt`). **Structured extraction now routes to real models through the host provider system (W3-2, 2026-10-29):** the MCP sampling channel (`sampling/createMessage` → adapters handler → `mcp-server-sampling` module → runtime `sampleModel`) carries classification/extraction/synthesis with task-shaped `modelPreferences`; provenance records the executed model per record (`zcode:routed:<model>`), and the labeled heuristic adapter remains only as a recorded fallback (`heuristic:* (fallback: …)`) — proven on real uploads with a real model (`evidence/2026-10-29-w3-2-sampling-bridge-run.txt`). **Production path verified through the REAL host (W3-3, 2026-10-29):** `zcode agent-server` — the actual CLI runtime entry — executed the full marketing mission with a real personal provider in its provider registry (GLM glm-4-plus): the real agent loop called all six `marketing_*` tools through the real permission broker, extraction routed with `zcode:routed:glm-4-plus` provenance, and a deterministic sampling-kill run (agent traffic forwarded verbatim; sampling-shaped requests rejected 401 non-retryable) stamped the labeled fallback in every record (`evidence/2026-10-29-w3-3-real-host-provider-run.txt`; reproduce with `pnpm --filter @zcode/marketing-plugin demo:w3-3`). Remaining gap on this map: the rendered evidence-viewer UI panel follows the office-plugin `ui.surfaces` pattern (review Priority 3, next order).
