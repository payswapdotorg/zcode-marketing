# MARKETING-EVALUATION

> Research quality benchmarks, creative assessment, forecast calibration, and experiment evaluation. Owned by Worker C with Worker B (calibration infrastructure). Last updated: 2026-10-28 (W1 fixtures baseline).

## Principle

The product is not "ready" because the UI looks polished or a model produces an impressive strategy. Every quality claim is measured on a **versioned evaluation set** against a **documented baseline** — never by subjective inspection alone.

## Evaluation sets (all versioned under `packages/marketing` fixtures / `docs/marketing/evidence/`)

| Set | Measures | Method |
| --- | --- | --- |
| Research quality | Competitor discovery recall/precision on labeled categories; coverage honesty (no invented data); provenance completeness of every recommendation | Fixtures with known ground truth; a recommendation without a traceable EvidenceReference is an automatic failure |
| Creative feature extraction | Hook/narrative/offer extraction consistency across repeated runs; alignment of visual events with transcript timestamps where sources permit | Double-annotated fixtures; inter-run stability metrics |
| Strategy quality (Stages A–D) | Stage A: competitor relevance confidence calibration. Stage B: feature extraction fidelity. Stage C: like-for-like measurement correctness (velocity vs totals, objective-appropriate metrics). Stage D: intersection evidence — independent-source support, contrary examples present, confidence honest | Scenario fixtures incl. adversarial ones (sparse data, region gaps, conflicting signals) |
| Brief usability | Briefs are usable, platform-appropriate, and adhere to the product's offer/audience/brand/objective | Rubric-scored against baseline; rubric itself versioned |
| Asset validation | Opening communicates intended benefit; product represented accurately; proof present; CTA supports goal; meets platform technical/policy requirements | Rule-based checks + model-assisted rubric; suggest corrections without silently changing approved creative |
| Forecast calibration | Predicted ranges vs recorded outcomes across experiments; calibration error over time; preserved original forecasts (never rewritten) | Brier-style scores per metric class; calibration table recomputed per W6 run |
| Learning quality | Next-experiment recommendation references recorded evidence instead of repeating previous output; successful elements kept, weakest contradicted assumptions changed | Paired-run comparison fixtures |

## Gates from the blueprint (non-negotiable, restated)

- **Research integrity**: unknown advertiser identity, unavailable metrics, uncertain classifications, and incomplete coverage are explicit, never invented.
- **Historical correctness**: snapshot ingestion repeatable; metric definitions versioned where necessary; as-of queries reproduce recorded evidence without substituting current values.
- **Creative quality**: usable, platform-appropriate briefs on a versioned evaluation set, compared against a documented baseline.
- **Publishing safety**: no publication without required authorization; retries create no duplicates; credentials stay out of prompts/logs/artifacts.
- **Learning quality**: original forecasts stored next to actual observations; backtesting assesses forecast error and calibration; next experiment references relevant evidence.

## Anti-overfitting rules (encoded, not prompted)

- One successful post does not prove causality. Strong claims require comparable variations, controlled differences, and sufficient observations.
- Views/shares/comments are indicators, **not** interchangeable with leads, purchases, or profit. The learning system optimizes the user's chosen business outcome.
- Contradicting evidence must be surfaced, not averaged away.

## Baseline discipline

1. Before any creative-quality judgment, record a baseline run of the evaluation set (model versions + fixtures pinned).
2. Changes that affect quality re-run the set; deltas are reported with the PR (this is what "compared with a documented baseline" means).
3. Evaluation results live in `docs/marketing/evidence/` as committed artifacts with run metadata.

## Current status (honest)

- Fixtures for the loop demo (sample connector data, known ground truth) exist in `packages/marketing/src/adapters/fixtures` and back the first conformance run.
- **Asset-validation rubric: machine-implemented as of W4 (2026-10-29).** `packages/marketing/src/app/rubric.ts` implements the versioned rule set (`RUBRIC_VERSION = 'v1'`): opening-benefit, product-accuracy, proof-present, cta-objective (objective-appropriate CTA verbs), platform-tech (per-platform format/aspect/duration limits), claims-honesty (superlatives vs substantiation markers), brand-constraints (machine-checkable subset, e.g. discount language against a discount-constraining brief) and competitor-trademarks. Deterministic halves are pure functions (9/9 domain tests); the qualitative half routes through the `validateAsset` capability task with provenance recorded (`assessedBy`) and the labeled heuristic as fallback. The rubric reports and suggests — it never edits the creative or auto-approves. Evaluation baselines for rubric v1 are the recorded chain run (`evidence/2026-10-29-w4-creative-handoff.txt`: clean declaration → verdict ready/score 1; discount copy against the constrained brief → blocked) and the browser artifacts (`evidence/0{6,7}-creative-*.png`).
- Brief-usability rubric: exercised through the W4 handoff pack (timed script, storyboard, generator-specific prompt packs, experiment spec) with drafting provenance (`draftedBy`); rubric-scored comparisons land with W6 when recorded outcomes exist.
- Forecast calibration fixtures require recorded real outcomes — W6; the demo currently exercises the *machinery* (forecast stored, outcome recorded, calibration hook) on synthetic-but-labeled data, which is explicitly labeled as such.
