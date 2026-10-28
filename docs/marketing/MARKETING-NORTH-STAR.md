# MARKETING-NORTH-STAR

> Authoritative source of truth for the product goal of this fork. If any other document, prompt, or plan disagrees with this file, this file wins. Last updated: 2026-10-28 (W0 baseline).

## What this fork is

This fork evolves ZCode into a **self-organizing marketing intelligence and execution workspace**. It is not a second agent framework, and it is not a chatbot wrapped around an ad-library search tool. ZCode's existing runtime (agent loop, tool execution, model/provider routing, sessions, permissions, task and subagent mechanisms) stays as the single execution engine; a **marketing domain layer** is added around it through existing extension points.

The defining capability is a **continuous learning cycle**:

1. **Define the product and marketing goal** — product, audience, country, platform, offer, desired outcome.
2. **Discover the competitive landscape** — ad libraries, competitor creatives, organic content, trends, authorized account analytics.
3. **Find the winning intersection** — what appears effective in paid advertising × what resonates in organic content.
4. **Generate an evidence-backed creative brief** — angle, hook, script, format, visual direction, CTA, production prompt.
5. **Create, review, publish** — creative tools or user-made assets, scheduling, approved publishing integrations.
6. **Measure, learn, improve** — actual outcomes vs predictions → corrected hypotheses → the next content experiment.

Every cycle strengthens the evidence available for the next campaign. The differentiator is not that the system uses multiple models — it is that it **knows which evidence to gather, which specialist capability to invoke, what conclusion the evidence supports, what remains uncertain, and what experiment to run next**.

## User journey (canonical)

1. A user describes a product (offer, landing page, audience, country, platform, objective) in an onboarding flow.
2. The system proposes a competitor set with relevance confidence; the user can correct it.
3. The system researches paid and organic evidence within the limits of its verified data sources, and shows a **coverage ledger** (available / limited / not connected) instead of silently filling gaps.
4. The system ranks **evidence-backed creative opportunities** with explanations, contrary examples, and explicit uncertainty.
5. The system turns the selected opportunity into a structured creative brief and a generator-specific prompt pack (e.g. Higgsfield-compatible).
6. The user produces an asset (in any tool) and imports it back; the system validates it against the brief and platform requirements.
7. After explicit approval, the system publishes (or assists handoff) and starts measurement against the recorded hypothesis.
8. The system compares forecast vs outcome, records which assumptions were supported or contradicted, and recommends the next experiment.

## Measurable outcomes (what "done" means)

The first true release milestone is **one demonstrable loop**:

`product brief → real research → evidence-backed opportunity → creative prompt → user-created asset → approved publication → measured result → revised recommendation`

Per-wave acceptance gates are defined in `MARKETING-ROADMAP.md` and are non-negotiable (see "Acceptance gates"). A wave is not complete because an agent reports completion; it is complete when its gate passes with recorded evidence.

## Non-goals

- **Not** building a second planner loop, conversation engine, session engine, or subagent framework. The existing ZCode runtime executes everything.
- **Not** universal ad-library coverage. No API guarantees access to every advertiser's creatives, historical metrics, targeting, and conversions across all platforms, countries, and date ranges. Coverage is reported honestly, never faked.
- **Not** claiming "the highest-converting creative" or "the best-performing strategy" unless the evidence supports it. Ad longevity is a clue, not proof of profitability; views are not sales.
- **Not** bypassing authentication, CAPTCHAs, rate limits, or platform restrictions. A logged-in browser or working web page is never treated as permission to extract unlimited data.
- **Not** letting an organic-post approval authorize paid campaigns. Organic publishing and paid advertising are separate permission domains.
- **Not** maximizing engagement when the user's objective is leads, sales, or profit.
- **Not** copying competitors. The goal is reusable strategic patterns turned into original work for the user's product, brand, and constraints.

## Success metrics for the product itself

- Research integrity: every material recommendation carries traceable evidence references; unknowns are explicit.
- Learning quality: original forecasts are stored next to actual outcomes; backtesting shows forecast error and calibration improving over time; the next experiment references recorded evidence.
- Loop completion rate: share of missions that complete the full cycle rather than stopping at ideas.
- Preservation: the upstream ZCode regression baseline stays green (see `FEATURE-PRESERVATION-MATRIX.md`).

## Ownership

- This file is owned by the TL (architecture and integration owner, see `WORK-REGISTRY.md`).
- Workers propose changes via PR; the TL merges. Changes to Non-goals require an entry in `WORK-REGISTRY.md` with rationale.
