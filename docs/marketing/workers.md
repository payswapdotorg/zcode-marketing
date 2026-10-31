# Worker roster — independent worker execution (WO-G2, Phase 2)

> Governance: `docs/marketing/PHASE2-HANDOFF.md` WO-G2 (gate P7 — team execution). This file is the staffing record: who the workers are, what independence means here (and what it does not), how a worker session runs, and how work integrates. It replaces the single-agent role-lane execution model recorded 2026-10-29.

## 1. The three worker identities

| Identity | Git authorship | Lane | Assignment |
| --- | --- | --- | --- |
| **Worker R** | `zcode-worker-r <worker-r@zcode-marketing.invalid>` | research — temporal data & analytics infrastructure | WO-P5 (store semantics, fixtures, anti-fabrication) |
| **Worker C** | `zcode-worker-c <worker-c@zcode-marketing.invalid>` | creative — marketing intelligence & creative experience | WO-P5 (panel coverage disclosure at point of use) |
| **Worker P** | `zcode-worker-p <worker-p@zcode-marketing.invalid>` | publishing & measurement — platform access, connectors, publication, analytics | WO-P1 phases 4–6 support, then WO-P2/WO-P3 when gate P1 closes (dependency-blocked until the TL/brand inputs land) |

## 2. What these identities are — stated honestly

Each worker is an **independent agent session** spawned by the TL's runtime (the runtime's subagent facility). Concretely:

- **Separate context.** A worker session receives only its written brief (work-order scope, file map, conventions, the pinned integration contract, and what to report back). It cannot read the TL's conversation, any prior session's history, or another worker's in-flight state.
- **Genuinely parallel execution.** Worker sessions spawned in the same batch execute concurrently — wall-clock overlap is the concurrency evidence AT-G2.4 requires, recorded as spawn/completion timestamps plus each worker's own runtime task identifier in the registry entry.
- **Integration only through TL review.** Workers do not push. A worker's output lands on `main` only after the TL reviews the diff (contract, integration, evidence), runs the gates, and commits it under the worker's authorship (`git commit --author`). The TL remains the architecture-policy owner of module `marketing` and the single integration point.

**What independence here does NOT mean (recorded, not implied):** the workers run the same model family as the TL. Independence is of context and execution, not adversarial diversity — a model-family blind spot can recur across workers. That is exactly why AT-G2.2 keeps TL contract/integration/evidence/acceptance sign-offs mandatory on every work order, and why the CI gates (not any worker's self-report) are the mechanical authority. No task is complete merely because a worker reports it finished — the recorded evidence rule of `WORK-REGISTRY.md` applies to workers identically.

## 3. Worker session protocol

1. **Brief (the contract).** The TL writes the brief before spawning: work-order slice, exact scope boundaries (files this worker may touch), the repo conventions that bind it (honesty rules, additive-schema discipline, architecture policy, no-fabrication), the pinned integration contract for any cross-lane seam, the targeted tests to run, and the report format to return.
2. **Execution.** The worker session works autonomously inside its boundaries. It may read anything in the repository, but writes only within its assigned file set. It runs its own targeted tests and reports their real output — a worker that reports a gate it did not run, or a count it did not see, is a contract violation the TL review catches.
3. **Report.** The worker returns: what it built (files, exported surface), the exact test commands it ran with their real output tails, its design decisions and any deviation from the brief (with reasons), and what it could NOT verify.
4. **TL review.** Four sign-offs per work order: **contract** (the implementation matches the brief and the work order, or the deviation is recorded), **integration** (cross-lane seams match the pinned contract; no out-of-bounds writes), **evidence** (test/gate output real and sufficient), **acceptance** (the AT identifiers the slice closes). Each review is a registry entry with findings and decision.
5. **Landing.** The TL commits the reviewed work under the worker's authorship, one commit per worker slice, and records the registry entry with the worker identity, session evidence, and commit hash.

## 4. TL role (redefined by WO-G2)

The TL does not personally implement lane work except where a lane is blocked. The TL: assigns work orders to lanes; writes and reviews the briefs/contracts before implementation; reviews integration between lanes; reviews evidence before closure; signs off acceptance; owns the guard protocol, the wave plan, and the registry.

## 5. Concurrency evidence format (AT-G2.4)

A wave that claims concurrency records, per shipping lane: worker identity, runtime task identifier, spawn timestamp, completion timestamp, brief file, commit hash (authored by the worker, integrated by the TL), and the registry entry link. Two lanes shipping in the same wave with wall-clock-overlapping sessions is the evidence; same-wave commits from distinct author identities are the durable trace.

## 6. Status

- **Staffed 2026-10-31 (W8-3):** Workers R and C spawned in parallel on WO-P5 (the first concurrent wave — registry entry records the session evidence). Worker P staffed and assigned, first execution blocked on WO-P1 entry conditions 0.3–0.5 (TL/brand inputs), per the dependency edges in the handoff.
- **AT-G2.1:** partially met at staffing (two of three identities executing; third staffed with a recorded dependency block). Closes when Worker P executes its first work order.
- **AT-G2.2:** in force from this wave — every work order closed in Phase 2 carries the four TL sign-offs in its registry entry.
- **AT-G2.3:** the WO-P5 signal-disclosure seam (store semantics → report payload → panel rendering) is the first cross-lane integration review; recorded with findings and resolutions when the wave lands.
- **AT-G2.4:** first concurrency evidence from the W8-3 wave (two lanes, one work order); distinct-work-order parallelism lands when gate P1 closes and WO-P2/WO-P3 unblock.
