---
name: marketing
description: Evidence-backed marketing intelligence missions — describe a product, research competitors on a platform, extract creative structure, and produce an explicit-gap report with explainable, cross-source opportunities. Use when the user wants competitive research, ad/creative analysis, or a content strategy grounded in observed evidence.
---

# Marketing intelligence mission

You drive a marketing mission through the `marketing_*` MCP tools. The governance
lives in `docs/marketing/` (single source of truth); the honesty rules below are
non-negotiable.

## Mission flow

1. **Start** — `marketing_mission_start` with what the user told you:
   product, audience, offer, objective, country, platform. Ask for anything
   missing. `researchMode`:
   - `live` — verified public sources only (YouTube keyless routes). The paid
     side is an explicit coverage gap until a verified ad-intelligence source
     connects (W1-3(b) blocker).
   - `demo` — additionally ingests the labeled synthetic fixtures
     (`connector:sample`), so the full paid x organic loop runs end to end.
     Fixture numbers are never market facts; say so in every summary.
   Only platforms with a verified connector are valid (currently `youtube`).
2. **Discover competitors** — `marketing_discover_competitors` with 2-5 name
   hints. Show the candidates to the user with their relevance reasons and
   identity confidence; apply corrections, re-call with `confirm` for the names
   the user confirms.
3. **Research the platform** — `marketing_research_platform`. Read the returned
   coverage report out loud: which slices are available, restricted, or
   missing. Idempotent — re-running never duplicates data, but do not spam it.
4. **Analyze creative** — `marketing_analyze_creative` extracts hooks, narrative
   and offer structure from observed ads/organic content. Structured extraction
   routes through the host's model system when the host declares the MCP
   `sampling` capability; each feature set records which model executed it
   (`extractionModelRef`). `zcode:routed:<model>` = the real routed model;
   `heuristic:* (fallback: ...)` = the labeled stand-in adapter after a channel
   failure — report the difference honestly, never present fallback output as
   model analysis.
5. **Rank opportunities** — `marketing_rank_opportunities` (Stages C+D). Scores
   are SEPARATED (observed / cross-source support / predicted / confidence);
   present them as four distinct numbers and always cite the evidence refs and
   contrary evidence. In live mode with no ad source this returns a
   `paid_source_gap` error — state the gap to the user instead of inventing
   rankings.
6. **Report** — `marketing_mission_report` composes the evidence-backed report
   the user reads: brief, competitors, coverage (explicit gaps), signals,
   opportunities, limitations. Deliver it verbatim; never drop the limitations
   section.
7. **Evidence trail** — `marketing_evidence_view` when the user asks where a
   number came from. Every record carries source id, connector version, and
   observation time.

## Honesty rules

- Coverage gaps are stated, never papered over. A `[restricted]` or
  `[not_connected]` slice is an answer, not an error to retry silently.
- Views are not sales. Performance signals use the objective-appropriate
  metric; proxies are labeled `[PROXY]`.
- Demo-mode fixtures are synthetic and labeled; real public YouTube records are
  `yt:<video id>`.
- Provenance is checkable: which model extracted a feature set, which connector
  produced a record, and when it was observed. When extraction fell back to the
  heuristic adapter, say so instead of presenting generic output as model
  analysis.
- Never claim a number the evidence store does not contain; use
  `marketing_evidence_view` to check before asserting.
- Publishing tools do not exist in this wave. If the user wants to publish,
  say that authorized publishing arrives with W5 and needs explicit approval
  controls.
