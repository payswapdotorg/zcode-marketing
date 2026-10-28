# MARKETING-CAPABILITY-MAP

> How research, analysis, creative, publishing, and learning capabilities map onto the existing ZCode runtime and its extension points. Owned by the TL. Last updated: 2026-10-28 (W1 contracts baseline).

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

W0 audit confirmed the existence and location of the runtime pieces above from source inspection, and the full-environment gates have since been run and recorded (`evidence/2026-10-28-full-env-verification.txt`). The domain slice (W1/W2) proves the domain contracts, temporal semantics (in-memory AND SQLite persistence), and loop logic in `packages/marketing` with a sample connector plus one verified real connector (`connector:youtube-public`, keyless public organic routes). **Runtime execution is demonstrated (W3-1, 2026-10-28):** the official plugin `marketing` registers the mission tools on the CLI's stdio MCP plugin chain, and the full tool chain ran end-to-end through a real spawned server process (`evidence/2026-10-28-w3-plugin-chain-run.txt`). Remaining gaps on this map: structured extraction still routes to labeled heuristic adapters (real-model provider bridge is a follow-up work order), the rendered evidence-viewer UI panel follows the office-plugin `ui.surfaces` pattern in a follow-up order, and live-mode ad intelligence stays blocked on W1-3(b) credentials.
