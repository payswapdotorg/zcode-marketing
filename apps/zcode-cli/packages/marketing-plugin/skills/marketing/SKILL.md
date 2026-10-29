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
   - `live` — verified public sources only: organic via the keyless YouTube
     public routes, paid via the Google Ads Transparency Center keyless public
     route (both W1-3-verified; MARKETING-DATA-SOURCES.md). Real creatives,
     real advertisers; no impressions/spend/ROAS — stated as coverage limits.
   - `demo` — additionally ingests the labeled synthetic fixtures
     (`connector:sample`), so the full paid x organic loop runs end to end.
     Fixture numbers are never market facts; say so in every summary.
   Only platforms with a verified connector are valid (currently `youtube`).
   The user can also start, discover, and research missions from the Marketing
   workspace panel (the plugin's `ui.surfaces` entry); results of your tool
   calls route there automatically. Talk the user through the panel when they
   prefer a visual workbench over chat-driven steps.
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
   contrary evidence. In live mode, zero ad observations returns a
   `paid_source_gap` error — usually none of the mission's competitors resolved
   to an advertiser with ads in the mission region; state the gap to the user
   instead of inventing rankings.
6. **Report** — `marketing_mission_report` composes the evidence-backed report
   the user reads: brief, competitors, coverage (explicit gaps), signals,
   opportunities, limitations. Deliver it verbatim; never drop the limitations
   section.
7. **Evidence trail** — `marketing_evidence_view` when the user asks where a
   number came from. Every record carries source id, connector version, and
   observation time. The same trail renders in the workspace panel's Evidence
   tab.

## The workspace panel (W3-4)

The plugin ships a branded Marketing panel (`ui://marketing/panel.html`, the
office-panel convention): mission list, onboarding form, competitor discovery
and confirmation, one-click idempotent research, the honest coverage report,
performance signals, ranked opportunities with separated scores, the full
evidence trail with provenance, and (W4) the Creative tab — hypotheses with
"Draft handoff pack", the pack cards (timed script, storyboard, prompt packs,
experiment spec), explicit approve/reject, the bring-back form (chunked file
import + declaration) with the versioned rubric report. Panel-routed tools
declare `_meta.ui.resourceUri` so the host forwards their results to the
surface — the panel refreshes as you work. The panel calls the same tools you
do; there is no parallel data path.

## Creative handoff (W4)

After `marketing_rank_opportunities` (hypotheses persist with stable ids):

1. **Draft** — `marketing_draft_creative` (omit hypothesisId for the top
   opportunity). Produces the production pack: creative brief, timed 4-beat
   script, storyboard, generator-specific prompt packs (video-gen + thumbnail
   + copy variants), and the testable experiment spec (metric + window +
   changed variables). Provenance recorded (`brief.draftedBy`).
2. **Review** — `marketing_review_artifact` with an explicit `decision`
   (approve/reject) and `reviewedBy`. Nothing auto-approves; double transitions
   are refused. Publishing (W5) requires an approved artifact.
3. **Produce** — the user takes the prompt packs into their creative platform.
4. **Bring back** — `marketing_asset_import_begin/write/finish` (chunked; the
   file lands under `.zcode/marketing/missions/<id>/assets/`) then
   `marketing_record_asset` with the declaration of what the asset contains
   (opening/hook, proof, CTA, transcript/copy, format/duration/aspect). The
   versioned rubric (`v1`) runs: deterministic rule checks (opening-benefit,
   product-accuracy, proof-present, cta-objective, platform-tech,
   claims-honesty, brand-constraints incl. discount/trademark scans,
   file-present) + the routed qualitative assessment — provenance in
   `rubric.assessedBy`. The rubric SUGGESTS corrections; it never edits the
   creative or approves anything. A blocked verdict (any fail) should be fixed
   before approval; state that honestly to the user.
5. **Compare** — `marketing_compare_assets` for the side-by-side rubric
   verdicts across recorded assets before choosing what to publish.

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
