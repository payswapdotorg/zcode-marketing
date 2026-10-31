# WO-P5 execution plan — Historical intelligence integrity

| Field | Value |
|---|---|
| Work order | [WO-P5](../PHASE2-HANDOFF.md) — gate P5 (historical integrity) |
| Lane / executors | research lane (**Worker R**) + creative lane (**Worker C**) — first concurrent worker wave under [WO-G2](../workers.md) |
| Plan version | 1.0 — 2026-10-31 (W8-3) |
| Base commit | `8882e74a` — WO-P5 bound to it 2026-10-31 (`reset-guard` bind; recovery event `recon-2026-10-31T033500000Z-1` covers the session-start reset) |

## 1. Scope split and the cross-lane seam

WO-P5's five scope items split across two lanes with one pinned seam:

| Scope item | AT | Lane | Files this worker may touch |
|---|---|---|---|
| 1. Record-type separation (source, observed-at, reported-at; record type distinguishing source-reported dates, first-party observations, estimates; filterable queries) | AT-P5.3 | **R** | `packages/marketing/src/domain/records.ts`, `packages/marketing/src/app/temporalStore.ts`, `packages/marketing/src/app/workflows.ts`, `packages/marketing/src/adapters/sqliteStore.ts`, `packages/marketing/test/*` |
| 2. As-of reproducibility (fixture-based: same ingestion history → identical snapshots for the same as-of time) | AT-P5.1 | **R** | same as above (new fixture test files under `packages/marketing/test/`) |
| 3. Explicit absence (pre-coverage queries return a stated no-observation result, never interpolated; first-class and testable on every access path) | AT-P5.2 | **R** produces the store/workflow semantics; **C** carries them to the panel | R: same as above · C: `apps/zcode-cli/packages/marketing-plugin/src/server.ts`, `src/w5Tools.ts`, `src/w6Tools.ts`, `ui/types.ts`, `ui/render.ts`, `ui/panel.ts`, `ui/state.ts`, `test/panel.test.ts` |
| 4. Coverage disclosure in the workspace UI (source coverage windows and limits visible wherever sources feed ranked output — handoff Section 11) | AT-P5.4 | **C** | same as above |
| 5. Anti-fabrication invariant, code plus test (no ingestion or query path synthesizes observations for times the system did not observe) | AT-P5.5 | **R** | same as above |

Out of scope (work order, unchanged): third-party historical datasets; changing the store engine (no rewrite — the SQLite adapter keeps its append-only revision discipline; changes are additive).

## 2. Pinned integration contract (TL-defined; both briefs carry it verbatim)

The performance-signal seam between the store/workflow layer (R) and the panel payload/ rendering (C):

```ts
// Signal gains one optional field. Velocity/total stay optional and absent
// exactly when no observation supports them — the new field says WHY, so the
// panel can state absence instead of rendering nothing.
noObservation?: {
  reason: 'before_coverage' | 'insufficient_window' | 'not_observed';
  detail: string; // honest, self-contained, e.g. "first observation of this
                  // entity is 2026-10-29T10:00:00Z — the window begins after it"
};
```

- **R** implements it at `workflows.ts` `performanceSignals()` (and any store query that backs it): when `velocity` and `total` are both undefined, the signal carries `noObservation` with the true reason; a signal with a value never carries `noObservation`.
- **C** mirrors it in `performanceSignalShape` (`server.ts`) and the UI `Signal` type, and renders an explicit no-observation chip where a signal shows no values — never a blank row, never a zero.
- Field name, reason enum, and optionality are frozen by this contract; any change is a TL decision recorded here first.

## 3. Worker R brief — store semantics and fixtures (research lane)

**Objective.** Make historical semantics explicit, reproducible, and mechanically honest at the data layer: record types are distinguishable and filterable, as-of snapshots are reproducible from fixtures, absence is a first-class outcome, and fabrication is rejected by code, not by convention.

**Boundaries.** Only the files listed in §1 (research-lane set). Additive schema changes only: every new zod field is optional or carries a default so records recorded before this change parse unchanged (the W1-3(b) `availableMetadata` precedent). No store-engine rewrite: `TemporalStore` (in-memory) and the SQLite adapter keep their current engines and revision discipline; new fields ride the existing record JSON. Architecture policy: domain stays pure (no I/O in `domain/`).

**Design decisions pinned by the TL (contract review).**

1. *Record-type separation.* `MetricObservation` is the gap: it carries `observedAt` (when we measured) and `source`, but neither `reportedAt` (when the platform says the value was current — may legitimately differ) nor a record type. Add, additively: `reportedAt?: isoDateTime` and `recordType: z.enum(['first_party_observation', 'source_reported', 'estimate']).default('first_party_observation')`. The entity records (`AdCreative`, `OrganicContent`) already separate our observation timestamps (`firstObservedAt`/`lastObservedAt`) from platform-reported values (`publishedAt`, `availableMetadata` delivery dates) — record that mapping in the plan evidence rather than churning their schemas; `CoverageReport` slices already carry `dateWindow`.
2. *Filterable queries.* The as-of query paths (`metricsAsOf`, `latestObservation`) gain an optional options argument filtering on record type — additive, existing callers unchanged.
3. *First-class absence.* The store/workflow layer answers pre-coverage queries with an explicit no-observation result (per the §2 contract at the signal level; at the store level the empty series is distinguishable from "no data because before coverage" — the workflow composes the reason honestly from the series' actual first observation).
4. *Anti-fabrication invariant.* The store fixes, per `(metricKey, subjectRef)` series, the earliest `observedAt` it has ever ingested (the floor of the first batch that introduced the series). A later ingest offering a record with `observedAt` earlier than that floor is rejected loudly as a typed outcome (recorded in the ingest audit; never silently accepted, never mutated into the series). The system did not observe before it started observing — backfill claiming otherwise is fabrication. Re-ingesting the same earliest record is an ordinary duplicate, not a violation.

**Tests (the fixture suite joins the root credentials-free CI suite automatically via `packages/marketing/test/`).** New fixture file(s) covering: AT-P5.1 (two stores, identical ingestion history, byte-identical as-of snapshots at several as-of times including one between observations); AT-P5.2 (pre-coverage as-of query returns the explicit no-observation result; post-coverage returns values); AT-P5.3 (record-type and `reportedAt` fields present, parsed, and filtered — old-shaped records without the new fields still parse and default correctly); AT-P5.5 (the floor-rejection: a late record with `observedAt` before the series floor is rejected and audited, the series unchanged; the honest duplicate is accepted as duplicate).

**Report back.** Files touched; exported surface added; the exact test commands run with their real output tails; the exact rule you implemented for the anti-fabrication floor; any deviation from this brief with reasons; what you could not verify.

## 4. Worker C brief — coverage disclosure at point of use (creative lane)

**Objective.** Wherever the panel draws on source records to rank or signal, the coverage window and limits of those sources are visible at the point of use (handoff Section 11), and absent observations are stated, not blanked.

**Boundaries.** Only the files listed in §1 (creative-lane set). The panel ships as a self-contained `panel.html` inside its resource budget — keep the bundle within budget (the existing panel test enforces it). Bilingual strings (the `types.ts` string tables carry zh + en — both locales updated for every user-visible string). UI conventions: honesty rules preserved verbatim; removing or obscuring a disclosure is a regression, not a cleanup.

**Design decisions pinned by the TL (contract review).**

1. *Point-of-use disclosure.* The signals card and the opportunities list show, inline, the coverage window/limits of the sources feeding them — sourced from the coverage slices the report already carries (`slice.dateWindow`, `slice.note`, `slice.sourceId`). The rolling-window limit of the keyless organic feed (≈15 most recent uploads — a complete historical archive is NOT available) must be visible wherever organic records feed ranked output. The existing standalone coverage card stays; the point-of-use additions must not duplicate it wholesale — a compact inline form (window + limit marker) at the point of use, the full card where it already is.
2. *No-observation rendering.* Per the §2 contract: a signal with neither `velocity` nor `total` renders an explicit no-observation chip with the reason; never blank, never zero, never interpolated. If the field is absent (older report shape), fall back to the honest "no observation recorded" wording rather than inferring a reason.
3. *Report payload.* `performanceSignalShape` gains the contract field so it flows from the workflow output to the panel; the structured output stays backward-compatible (optional field).

**Tests.** Extend `test/panel.test.ts`: AT-P5.4 (a rendered report with coverage slices shows the window/limit markers at the signals/opportunities point of use — assert on rendered HTML strings the same way the existing panel tests do); AT-P5.2-at-the-panel (a signal with `noObservation` renders the explicit chip with its reason; a valued signal renders no chip). The plugin suite must stay green (59/59 today; the count grows with your additions — report the real number).

**Report back.** Files touched; every user-visible string added (both locales); the exact test commands run with their real output tails; the rendered-HTML assertions you added; any deviation from this brief with reasons; what you could not verify.

## 5. Evidence and closure

Per work-order evidence requirements plus the WO-G2 protocol: fixture test runs, exported as-of snapshots including one no-observation case, UI coverage-disclosure assertions (the panel test suite is the CI-runnable form; screenshots follow when the panel is next driven in a browser E2E), and the registry entries with worker identities, session evidence, TL review records (contract, integration, evidence, acceptance), and commit hashes.

Gate P5 closes on the full WO-P5 record — this wave lands the store semantics and the panel disclosure; the work-order-level closure (including the as-of snapshot exports) is completed in the follow-up entry before W10 per the wave plan.
