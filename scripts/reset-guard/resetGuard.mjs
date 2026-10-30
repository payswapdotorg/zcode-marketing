// WO-G1 — sandbox-reset prevention guard (Phase 2 platform lane, Wave W8).
//
// Purpose: make the failure class recorded twice on 2026-10-30 — an authoring
// sandbox reset to an old commit while origin/main already held the completed
// implementation, followed by an undetected parallel rebuild — mechanically
// impossible to repeat silently. The guard refuses work from a stale base,
// refuses pushes from a dirty tree or an unexpected commit, writes a
// machine-readable session checkpoint, and records recovery events in the
// format the work registry expects.
//
// Design constraints (deliberate):
//   - ZERO dependencies beyond node: builtins. The guard must run in exactly
//     the broken environments it guards against: a freshly reset sandbox with
//     no node_modules, a purged workspace install, a CI checkout. If it
//     needed the workspace install it would be unusable at the moment it is
//     needed most.
//   - Sync git subprocess calls (execFileSync): guards are short-lived CLI
//     invocations, not servers.
//   - Silent pass (AT-G1.5): a passing guard prints nothing on stdout. The
//     reports only appear when work must be refused. `status` is the human
//     inspection command.
//
// Relationship to scripts/check-workspace-freshness.mjs: that upstream tool
// is advisory (session-start staleness hints with thresholds and warnings).
// This guard is the enforcing complement required by WO-G1: work-order base
// binding, push gating, checkpoints, and the recorded-reconciliation escape
// hatch. Both run at session start; only this one gates pushes.
//
// Reconciliation policy (unchanged by WO-G1, encoded here only as recorded
// data): the completed remote state wins unless a verified-additive local
// improvement exists, in which case it is ported and redundant work is
// discarded. The guard never decides the policy; it records the decision and
// recognizes an explicitly recorded one (refusals turn into passes only when
// a reconciliation record covers the exact divergence).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const GUARD_DIR_NAME = ".reset-guard";
export const CHECKPOINT_SCHEMA_VERSION = 1;
export const MAIN_REF = "origin/main";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

/** Run git in cwd, return trimmed stdout. Throws on non-zero exit. */
export function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitQuiet(cwd, ...args) {
  // git writes progress to stderr even on success (e.g. `fetch`); a passing
  // guard must stay silent, so stderr is captured and discarded here.
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Resolve the repository URL of the `origin` remote, or null when absent. */
export function resolveRepositoryUrl(cwd) {
  try {
    return git(cwd, "remote", "get-url", "origin");
  } catch {
    return null;
  }
}

/** Full state snapshot of a repository working copy. */
export function resolveRepoState(cwd) {
  const head = git(cwd, "rev-parse", "HEAD");
  let branch = "HEAD";
  try {
    const abbrev = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    if (abbrev !== "HEAD") branch = abbrev;
  } catch {
    // detached HEAD — keep the "HEAD" label
  }
  return {
    repositoryUrl: resolveRepositoryUrl(cwd),
    head,
    branch,
    dirtyFiles: listDirtyFiles(cwd),
  };
}

/**
 * Files with uncommitted changes (porcelain v1, -z parsing: rename entries
 * occupy two NUL-separated fields; both paths are listed so an operator sees
 * the full picture). Untracked files count as dirty for push purposes —
 * except the guard's own state directory: the guard writes checkpoints at
 * session start and must never block a push because of its own bookkeeping
 * (the repo additionally gitignores the directory; this filter keeps the
 * guard self-consistent even where the ignore rule is missing).
 */
export function listDirtyFiles(cwd) {
  const raw = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z"],
    { cwd, encoding: "utf8" },
  );
  const entries = raw.split("\0").filter((entry) => entry !== "");
  const files = [];
  const isGuardOwned = (file) => file === GUARD_DIR_NAME || file.startsWith(`${GUARD_DIR_NAME}/`);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (!isGuardOwned(file)) files.push(file);
    if (status[0] === "R" || status[0] === "C") {
      i += 1; // the second NUL field is the source path of the rename/copy
    }
  }
  return files;
}

/** Fetch origin (progress suppressed). Throws when unreachable. */
export function fetchOrigin(cwd) {
  gitQuiet(cwd, "fetch", "origin", "--prune");
}

/** Remote HEAD of MAIN_REF, or null when the ref does not exist. */
export function resolveRemoteHead(cwd, { fetch = false } = {}) {
  if (fetch) fetchOrigin(cwd);
  try {
    return git(cwd, "rev-parse", "--verify", `${MAIN_REF}^{commit}`);
  } catch {
    return null;
  }
}

/**
 * Compare HEAD against MAIN_REF. Relation: "in-sync" (behind 0), "behind",
 * "ahead", or "diverged" (both directions non-zero).
 */
export function compareWithRemote(cwd, { fetch = false } = {}) {
  if (fetch) fetchOrigin(cwd);
  const remoteHead = resolveRemoteHead(cwd);
  if (remoteHead === null) {
    throw new Error(
      `reset-guard: no ${MAIN_REF} ref after fetch — refusing to guess the baseline (does origin have a main branch?)`,
    );
  }
  const localHead = git(cwd, "rev-parse", "HEAD");
  const behind = Number(git(cwd, "rev-list", "--count", `HEAD..${MAIN_REF}`));
  const ahead = Number(git(cwd, "rev-list", "--count", `${MAIN_REF}..HEAD`));
  const relation =
    behind === 0 && ahead === 0
      ? "in-sync"
      : behind > 0 && ahead === 0
        ? "behind"
        : behind === 0 && ahead > 0
          ? "ahead"
          : "diverged";
  return { localHead, remoteHead, relation, behind, ahead };
}

/** Short delta summary: counts plus the first incoming commit subjects. */
export function divergenceDeltaSummary(cwd, comparison) {
  const subjects =
    comparison.behind > 0
      ? git(cwd, "log", "--format=%h %s", `HEAD..${MAIN_REF}`)
        .split("\n")
        .filter((line) => line !== "")
      : [];
  const head = subjects.slice(0, 5);
  const more = subjects.length - head.length;
  const incoming = subjects.length === 0 ? "" : ` incoming: ${head.join(" | ")}${more > 0 ? ` | (+${more} more)` : ""}`;
  return `local ${comparison.localHead.slice(0, 12)} vs ${MAIN_REF} ${comparison.remoteHead.slice(0, 12)} — ahead ${comparison.ahead}, behind ${comparison.behind}.${incoming}`;
}

// ---------------------------------------------------------------------------
// guard state directory (.reset-guard/, gitignored, machine-readable only)
// ---------------------------------------------------------------------------

function guardDir(cwd) {
  return path.join(cwd, GUARD_DIR_NAME);
}

function readGuardJson(cwd, file, fallback) {
  const target = path.join(guardDir(cwd), file);
  if (!existsSync(target)) return fallback;
  return JSON.parse(readFileSync(target, "utf8"));
}

function writeGuardJson(cwd, file, payload) {
  const dir = guardDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// scope 4 — session/workspace checkpoints
// ---------------------------------------------------------------------------

const CHECKPOINT_FIELDS = [
  "schemaVersion",
  "repositoryUrl",
  "head",
  "branch",
  "dirtyFiles",
  "openWorkOrders",
  "writtenAt",
];

/**
 * Validate a checkpoint object. Returns { valid, errors[] } — never throws —
 * so callers can report every field problem at once (AT-G1.3 rejects
 * malformed checkpoints with explicit reasons).
 */
export function validateCheckpoint(checkpoint) {
  const errors = [];
  const fail = (field, reason) => errors.push(`${field}: ${reason}`);
  if (checkpoint === null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return { valid: false, errors: ["checkpoint: must be a JSON object"] };
  }
  if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    fail("schemaVersion", `expected ${CHECKPOINT_SCHEMA_VERSION}, got ${JSON.stringify(checkpoint.schemaVersion)}`);
  }
  if (typeof checkpoint.repositoryUrl !== "string" || checkpoint.repositoryUrl === "") {
    fail("repositoryUrl", "must be a non-empty string (origin remote URL)");
  }
  if (typeof checkpoint.head !== "string" || !SHA_PATTERN.test(checkpoint.head)) {
    fail("head", "must be a full 40-char commit sha");
  }
  if (typeof checkpoint.branch !== "string" || checkpoint.branch === "") {
    fail("branch", "must be a non-empty string");
  }
  if (!Array.isArray(checkpoint.dirtyFiles) || checkpoint.dirtyFiles.some((f) => typeof f !== "string")) {
    fail("dirtyFiles", "must be an array of file-path strings");
  }
  if (
    !Array.isArray(checkpoint.openWorkOrders) ||
    checkpoint.openWorkOrders.some(
      (wo) =>
        wo === null ||
        typeof wo !== "object" ||
        typeof wo.id !== "string" ||
        wo.id === "" ||
        typeof wo.base !== "string" ||
        !SHA_PATTERN.test(wo.base) ||
        typeof wo.boundAt !== "string" ||
        Number.isNaN(Date.parse(wo.boundAt)),
    )
  ) {
    fail("openWorkOrders", "must be an array of { id, base (40-char sha), boundAt (ISO timestamp) }");
  }
  if (typeof checkpoint.writtenAt !== "string" || Number.isNaN(Date.parse(checkpoint.writtenAt))) {
    fail("writtenAt", "must be an ISO-8601 timestamp string");
  }
  const unknown = Object.keys(checkpoint).filter((k) => !CHECKPOINT_FIELDS.includes(k));
  if (unknown.length > 0) fail("checkpoint", `unknown field(s): ${unknown.join(", ")}`);
  return { valid: errors.length === 0, errors };
}

/**
 * Write the machine-readable session checkpoint (WO-G1 scope 4) at
 * `.reset-guard/checkpoint.json`: repository URL, HEAD, branch, dirty-file
 * list, open work orders with their base commits, timestamp. The payload is
 * validated before writing — a malformed checkpoint is never persisted.
 */
export function writeCheckpoint(cwd, { writtenAt = new Date().toISOString() } = {}) {
  const state = resolveRepoState(cwd);
  const checkpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    repositoryUrl: state.repositoryUrl ?? "(no origin remote)",
    head: state.head,
    branch: state.branch,
    dirtyFiles: state.dirtyFiles,
    openWorkOrders: listWorkOrderBindings(cwd).map((binding) => ({
      id: binding.id,
      base: binding.base,
      boundAt: binding.boundAt,
    })),
    writtenAt,
  };
  const validation = validateCheckpoint(checkpoint);
  if (!validation.valid) {
    throw new Error(`reset-guard: refusing to write an invalid checkpoint: ${validation.errors.join("; ")}`);
  }
  writeGuardJson(cwd, "checkpoint.json", checkpoint);
  return checkpoint;
}

/** Read + validate the checkpoint. Throws with every schema violation listed. */
export function readCheckpoint(cwd) {
  const target = path.join(guardDir(cwd), "checkpoint.json");
  if (!existsSync(target)) {
    throw new Error(`reset-guard: no checkpoint at ${target} (write one first)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`reset-guard: checkpoint is not valid JSON: ${error.message}`);
  }
  const validation = validateCheckpoint(parsed);
  if (!validation.valid) {
    throw new Error(`reset-guard: malformed checkpoint: ${validation.errors.join("; ")}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// scope 2 — work-order base binding
// ---------------------------------------------------------------------------

/**
 * Bind a work order to its base commit (WO-G1 scope 2): the executor records
 * the base the order was accepted on; every later write re-asserts it.
 */
export function bindWorkOrder(cwd, id, { base = null, boundAt = new Date().toISOString() } = {}) {
  if (typeof id !== "string" || id === "") {
    throw new Error("reset-guard: bindWorkOrder requires a non-empty work-order id");
  }
  const baseSha = base ?? git(cwd, "rev-parse", "HEAD");
  if (!SHA_PATTERN.test(baseSha)) {
    throw new Error(`reset-guard: base must be a full 40-char sha, got ${JSON.stringify(baseSha)}`);
  }
  const store = readGuardJson(cwd, "work-orders.json", { version: 1, orders: {} });
  if (store.version !== 1) throw new Error(`reset-guard: unknown work-orders store version ${store.version}`);
  const binding = { id, base: baseSha, boundAt };
  store.orders[id] = binding;
  writeGuardJson(cwd, "work-orders.json", store);
  return binding;
}

/** All recorded bindings. */
export function listWorkOrderBindings(cwd) {
  const store = readGuardJson(cwd, "work-orders.json", { version: 1, orders: {} });
  return Object.values(store.orders ?? {});
}

export function dropWorkOrderBinding(cwd, id) {
  const store = readGuardJson(cwd, "work-orders.json", { version: 1, orders: {} });
  delete store.orders[id];
  writeGuardJson(cwd, "work-orders.json", store);
}

/**
 * Re-assert a work order's base before any write (WO-G1 scope 2). Passes
 * when HEAD still equals the bound base, or when a recorded reconciliation
 * explicitly covers the divergence (the recorded decision unblocks the order
 * — the guard recognizes policy, it does not make it).
 */
export function assertWorkOrderBase(cwd, id, { fetch = false } = {}) {
  const store = readGuardJson(cwd, "work-orders.json", { version: 1, orders: {} });
  const binding = store.orders?.[id];
  if (!binding) {
    return {
      ok: false,
      reason: `reset-guard: work order ${id} has no recorded base binding — run \`cli.mjs bind --wo ${id}\` before accepting work on it`,
    };
  }
  const head = git(cwd, "rev-parse", "HEAD");
  if (head === binding.base) return { ok: true };
  const covered = reconciliationCoversWorkOrder(cwd, { head, base: binding.base, fetch });
  if (covered) {
    return {
      ok: true,
      reconciled: true,
      reason: `reconciliation ${covered.id} covers ${binding.base.slice(0, 12)} → ${head.slice(0, 12)}`,
    };
  }
  const comparison = compareWithRemote(cwd, { fetch: false });
  return {
    ok: false,
    reason:
      `reset-guard: work order ${id} was accepted on base ${binding.base.slice(0, 12)} ` +
      `but HEAD is now ${head.slice(0, 12)} — the sandbox may have been reset. ` +
      `Current state: ${divergenceDeltaSummary(cwd, comparison)}. ` +
      `Reconcile explicitly (record-recovery) or re-bind the order on the new base.`,
  };
}

// ---------------------------------------------------------------------------
// scope 5 — recovery events (the recorded reconciliation escape hatch)
// ---------------------------------------------------------------------------

export const RECOVERY_REQUIRED_FIELDS = [
  "detectedAt",
  "localHead",
  "remoteHead",
  "divergenceSummary",
  "decision",
  "portedItems",
  "discardedWork",
];

/**
 * Record a sandbox-divergence recovery event (WO-G1 scope 5). All required
 * fields must be present (detection time, local + remote states, divergence
 * summary, decision, ported items, discarded-work inventory). The record
 * both persists machine-readably (reconciliations.json — the escape hatch
 * the other guards recognize) and renders the work-registry change-log
 * entry a wave must commit.
 */
export function recordRecoveryEvent(cwd, event) {
  const errors = [];
  if (event === null || typeof event !== "object") {
    throw new Error("reset-guard: recovery event must be an object");
  }
  for (const field of RECOVERY_REQUIRED_FIELDS) {
    if (!(field in event) || typeof event[field] !== "string" || event[field] === "") {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (typeof event.localHead === "string" && !SHA_PATTERN.test(event.localHead)) {
    errors.push("localHead must be a full 40-char sha");
  }
  if (typeof event.remoteHead === "string" && !SHA_PATTERN.test(event.remoteHead)) {
    errors.push("remoteHead must be a full 40-char sha");
  }
  if (typeof event.detectedAt === "string" && Number.isNaN(Date.parse(event.detectedAt))) {
    errors.push("detectedAt must be an ISO-8601 timestamp");
  }
  if (errors.length > 0) {
    throw new Error(`reset-guard: incomplete recovery event — ${errors.join("; ")}`);
  }
  const store = readGuardJson(cwd, "reconciliations.json", { version: 1, events: [] });
  if (store.version !== 1) throw new Error(`reset-guard: unknown reconciliations store version ${store.version}`);
  const record = {
    id: `recon-${event.detectedAt.replace(/[:.]/g, "")}-${store.events.length + 1}`,
    recordedAt: new Date().toISOString(),
    ...event,
  };
  store.events.push(record);
  writeGuardJson(cwd, "reconciliations.json", store);
  return { record, markdown: renderRecoveryEventMarkdown(record) };
}

export function listReconciliations(cwd) {
  const store = readGuardJson(cwd, "reconciliations.json", { version: 1, events: [] });
  return store.events;
}

/**
 * Does a recorded reconciliation explicitly cover this localHead? (Used by
 * the session-start and push guards: "this exact stale HEAD is a recorded,
 * reconciled state whose winning remote matches the current origin/main".)
 */
export function findCoveringReconciliation(cwd, { localHead, fetch = false } = {}) {
  if (fetch) fetchOrigin(cwd);
  const remoteHead = resolveRemoteHead(cwd);
  return (
    listReconciliations(cwd).find(
      (event) => event.localHead === localHead && (remoteHead === null || event.remoteHead === remoteHead),
    ) ?? null
  );
}

function isAncestor(cwd, maybeAncestor, descendant) {
  if (maybeAncestor === descendant) return true;
  try {
    git(cwd, "merge-base", "--is-ancestor", maybeAncestor, descendant);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does a recorded reconciliation explicitly cover a work order whose bound
 * base diverged from the current HEAD? Two incident shapes:
 *
 *   A. the sandbox reset AWAY from the order's base — the current HEAD is
 *      exactly the recorded stale local, and the recorded winning remote
 *      contains the bound base (the order's base survives in the state that
 *      won), or
 *   B. the bound base itself is the recorded stale local that the
 *      reconciliation superseded with the current remote state.
 */
export function reconciliationCoversWorkOrder(cwd, { head, base, fetch = false } = {}) {
  if (fetch) fetchOrigin(cwd);
  const remoteHead = resolveRemoteHead(cwd);
  for (const event of listReconciliations(cwd)) {
    if (remoteHead !== null && event.remoteHead !== remoteHead) continue;
    if (event.localHead === head && isAncestor(cwd, base, event.remoteHead)) return event;
    if (event.localHead === base) return event;
  }
  return null;
}

/** Render the work-registry change-log row for a recovery event. */
export function renderRecoveryEventMarkdown(record) {
  return [
    `**Sandbox-reset recovery event ${record.id} (recorded ${record.recordedAt}).**`,
    `Detection time: ${record.detectedAt}.`,
    `Local state: \`${record.localHead.slice(0, 12)}\` — remote state (\`origin/main\`): \`${record.remoteHead.slice(0, 12)}\`.`,
    `Divergence summary: ${record.divergenceSummary}`,
    `Decision: ${record.decision}`,
    `Ported items: ${record.portedItems}`,
    `Discarded-work inventory: ${record.discardedWork}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// scope 1 — session-start pre-flight
// ---------------------------------------------------------------------------

/**
 * Pre-flight check (WO-G1 scope 1): fetch origin, compare HEAD against
 * origin/main, and refuse to accept any work order from a stale base without
 * an explicitly recorded reconciliation. Returns { ok: true } silently on
 * the clean path, or { ok: false, report } with the full divergence report.
 */
export function preFlightCheck(cwd, { fetch = true } = {}) {
  const comparison = compareWithRemote(cwd, { fetch });
  if (comparison.relation === "in-sync" || comparison.relation === "ahead") {
    return { ok: true, comparison };
  }
  const covered = findCoveringReconciliation(cwd, { localHead: comparison.localHead, fetch: false });
  if (covered) {
    return {
      ok: true,
      reconciled: true,
      comparison,
      reason: `reconciliation ${covered.id} explicitly covers this divergence`,
    };
  }
  const report = [
    "reset-guard: PRE-FLIGHT REFUSED — stale base, no recorded reconciliation.",
    `local HEAD      : ${comparison.localHead}`,
    `${MAIN_REF.padEnd(15)}: ${comparison.remoteHead}`,
    `delta           : ${divergenceDeltaSummary(cwd, comparison)}`,
    `action          : reconcile explicitly (\`node scripts/reset-guard/cli.mjs record-recovery --input <json>\`)`,
    `                  then reset to the completed remote state (\`git merge --ff-only ${MAIN_REF}\` or \`git reset --hard ${MAIN_REF}\`),`,
    `                  commit the rendered registry row, and re-run the pre-flight.`,
  ].join("\n");
  return { ok: false, comparison, report };
}

// ---------------------------------------------------------------------------
// scope 3 — pre-push guard
// ---------------------------------------------------------------------------

/**
 * Pre-push guard (WO-G1 scope 3): refuse to push unless the working tree is
 * clean and HEAD matches the expected commit. Refusal also fires for a dirty
 * or diverged remote baseline without a recorded reconciliation — pushing
 * stale-base work is exactly how the 2026-10-30 parallel rebuild escaped.
 * The clean-state path passes silently (AT-G1.5).
 */
export function prePushGuard(cwd, { expectedCommit = null, fetch = true } = {}) {
  // 1. dirty working tree — always named, even when the base is also stale,
  //    so AT-G1.2's offender list is deterministic.
  const dirtyFiles = listDirtyFiles(cwd);
  if (dirtyFiles.length > 0) {
    return {
      ok: false,
      reason:
        `reset-guard: PUSH REFUSED — working tree is dirty (${dirtyFiles.length} file(s)); ` +
        `commit or stash before pushing. Offending files:`,
      offendingFiles: dirtyFiles,
    };
  }
  // 2. stale/diverged baseline without a recorded reconciliation.
  const comparison = compareWithRemote(cwd, { fetch });
  if (comparison.relation === "behind" || comparison.relation === "diverged") {
    const covered = findCoveringReconciliation(cwd, { localHead: comparison.localHead, fetch: false });
    if (!covered) {
      return {
        ok: false,
        reason:
          `reset-guard: PUSH REFUSED — HEAD is ${comparison.relation} ${MAIN_REF} and no reconciliation is recorded; ` +
          `a push from this base would repeat the 2026-10-30 parallel-rebuild incident. ` +
          `Reconcile first. ${divergenceDeltaSummary(cwd, comparison)}`,
      };
    }
  }
  // 3. unexpected HEAD.
  if (expectedCommit !== null) {
    const head = git(cwd, "rev-parse", "HEAD");
    if (head !== expectedCommit) {
      return {
        ok: false,
        reason:
          `reset-guard: PUSH REFUSED — expected HEAD ${expectedCommit.slice(0, 12)} but found ${head.slice(0, 12)}; ` +
          `the workspace changed since the expectation was recorded.`,
      };
    }
  }
  return { ok: true, comparison };
}
