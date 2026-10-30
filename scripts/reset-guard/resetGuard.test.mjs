// WO-G1 acceptance suite — sandbox-reset prevention guard (AT-G1.1 … AT-G1.5).
//
// Every test builds a REAL throwaway git repository in a temp directory with
// a local bare origin (no network, fully hermetic — the same real-git pattern
// as packages/services/test/gitService.test.ts) and exercises the guard
// library end to end. The AT-x.y identifiers are the acceptance tests named
// by the Phase 2 handoff (docs/marketing/PHASE2-HANDOFF.md, WO-G1); the
// mapping below is 1:1 so the evidence file can quote it directly.
//
// AT-G1.1 — local HEAD behind origin/main → work-order execution refuses and
//           prints a divergence report (local HEAD, remote HEAD, delta).
// AT-G1.2 — dirty working tree → push refuses with an explicit message
//           naming the offending files.
// AT-G1.3 — checkpoint write/read round-trips; schema validation rejects
//           malformed checkpoints.
// AT-G1.4 — a simulated sandbox divergence produces a work-registry recovery
//           event containing all required fields.
// AT-G1.5 — the clean-state path adds no friction: guards pass silently
//           with negligible overhead.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHECKPOINT_SCHEMA_VERSION,
  assertWorkOrderBase,
  bindWorkOrder,
  compareWithRemote,
  listDirtyFiles,
  listReconciliations,
  preFlightCheck,
  prePushGuard,
  readCheckpoint,
  recordRecoveryEvent,
  validateCheckpoint,
  writeCheckpoint,
} from "./resetGuard.mjs";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");
const roots = [];

function sh(cwd, command, ...args) {
  // stderr is captured and discarded: temp-repo git writes progress noise to
  // stderr that would otherwise flood CI logs and evidence transcripts.
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** A fresh repo pair: bare origin + working clone, both under a temp root. */
function makeRepoPair() {
  const root = mkdtempSync(path.join(tmpdir(), "reset-guard-suite-"));
  roots.push(root);
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  mkdirSync(origin);
  sh(root, "git", "init", "--bare", "-b", "main", origin);
  sh(root, "git", "clone", origin, work);
  sh(work, "git", "config", "user.email", "guard-suite@example.test");
  sh(work, "git", "config", "user.name", "Reset Guard Suite");
  return { root, origin, work };
}

function commitFile(work, name, content = "content\n") {
  writeFileSync(path.join(work, name), content);
  sh(work, "git", "add", name);
  sh(work, "git", "commit", "-m", `commit ${name}`);
}

/** Advance origin/main by one commit, pushed from a short-lived feeder clone. */
function advanceRemote(root, origin, subject) {
  const feeder = path.join(root, "feeder");
  sh(root, "git", "clone", origin, feeder);
  sh(feeder, "git", "config", "user.email", "feeder@example.test");
  sh(feeder, "git", "config", "user.name", "Remote Feeder");
  writeFileSync(path.join(feeder, subject), `remote ${subject}\n`);
  sh(feeder, "git", "add", subject);
  sh(feeder, "git", "commit", "-m", `remote commit ${subject}`);
  sh(feeder, "git", "push", "origin", "main");
  rmSync(feeder, { recursive: true, force: true });
}

/** The sandbox-reset shape from the 2026-10-30 incident: work left behind remote. */
function makeStaleRepo() {
  const pair = makeRepoPair();
  commitFile(pair.work, "base.txt");
  sh(pair.work, "git", "push", "-u", "origin", "main");
  advanceRemote(pair.root, pair.origin, "remote-work.txt");
  sh(pair.work, "git", "fetch", "origin");
  return pair;
}

/** Simulate the recorded sandbox reset: local HEAD rewound below remote. */
function simulateSandboxReset(work) {
  sh(work, "git", "reset", "--hard", "origin/main~1");
}

function runCli(cwd, ...args) {
  return execFileSync("node", [cliPath, ...args, "--no-fetch"], {
    cwd,
    encoding: "utf8",
    // stdio default (pipe) captures both streams; exit code surfaces on throw.
  });
}

function tryRunCli(cwd, ...args) {
  try {
    return { status: 0, stdout: runCli(cwd, ...args) };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout ?? "") };
  }
}

beforeEach(() => {});
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("AT-G1.1 — stale base refuses work-order execution with a divergence report", () => {
  it("refuses when local HEAD is behind origin/main and prints local/remote/delta", () => {
    const { work } = makeStaleRepo();
    const result = preFlightCheck(work, { fetch: false });
    expect(result.ok).toBe(false);
    expect(result.report).toContain("PRE-FLIGHT REFUSED");
    const comparison = compareWithRemote(work);
    expect(comparison.relation).toBe("behind");
    expect(result.report).toContain(comparison.localHead);
    expect(result.report).toContain(comparison.remoteHead);
    expect(result.report).toContain(`ahead 0, behind 1`);
    expect(result.report).toContain("remote commit remote-work.txt");
  });

  it("the CLI refuses with exit 1 and the same report on stdout", () => {
    const { work } = makeStaleRepo();
    const outcome = tryRunCli(work, "pre-flight");
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("PRE-FLIGHT REFUSED");
    expect(outcome.stdout).toContain("local HEAD");
    expect(outcome.stdout).toContain("origin/main");
  });

  it("a diverged HEAD (ahead and behind) is refused as well — the parallel-rebuild shape", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    commitFile(pair.work, "local-only.txt");
    advanceRemote(pair.root, pair.origin, "remote-only.txt");
    sh(pair.work, "git", "fetch", "origin");
    const comparison = compareWithRemote(pair.work);
    expect(comparison.relation).toBe("diverged");
    const result = preFlightCheck(pair.work, { fetch: false });
    expect(result.ok).toBe(false);
    expect(result.report).toContain("ahead 1, behind 1");
    expect(result.report).toContain("remote commit remote-only.txt");
  });

  it("work-order base assertion refuses after a sandbox reset rewinds HEAD", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    // Origin advances to the true current state; the workspace adopts it and
    // accepts the work order on that base (the correct flow).
    advanceRemote(pair.root, pair.origin, "remote-work.txt");
    sh(pair.work, "git", "fetch", "origin");
    sh(pair.work, "git", "reset", "--hard", "origin/main");
    bindWorkOrder(pair.work, "WO-P1");
    expect(assertWorkOrderBase(pair.work, "WO-P1", { fetch: false }).ok).toBe(true);
    // The sandbox reset from the 2026-10-30 incident: the workspace rewinds to
    // a commit older than the base the order was accepted on.
    simulateSandboxReset(pair.work);
    const afterReset = assertWorkOrderBase(pair.work, "WO-P1", { fetch: false });
    expect(afterReset.ok).toBe(false);
    expect(afterReset.reason).toContain("WO-P1");
    expect(afterReset.reason).toContain("sandbox may have been reset");
  });
});

describe("AT-G1.2 — dirty working tree refuses push and names the offending files", () => {
  it("refuses push naming every offending file (modified + untracked)", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    writeFileSync(path.join(pair.work, "modified.txt"), "local edit\n");
    sh(pair.work, "git", "add", "modified.txt");
    writeFileSync(path.join(pair.work, "untracked.txt"), "never committed\n");
    const result = prePushGuard(pair.work, { fetch: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("PUSH REFUSED");
    expect(result.offendingFiles).toContain("modified.txt");
    expect(result.offendingFiles).toContain("untracked.txt");
    expect(result.offendingFiles).not.toContain(".reset-guard");
  });

  it("the CLI guard-push refuses with exit 1 and the file list on stdout", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    writeFileSync(path.join(pair.work, "dirty-one.txt"), "dirt\n");
    const outcome = tryRunCli(pair.work, "guard-push");
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("PUSH REFUSED");
    expect(outcome.stdout).toContain("dirty-one.txt");
  });

  it("guard-push also refuses a stale base (the 2026-10-30 escape route) even when clean", () => {
    const { work } = makeStaleRepo();
    const result = prePushGuard(work, { fetch: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("PUSH REFUSED");
    expect(result.reason).toContain("behind");
  });

  it("an unexpected HEAD refuses push even on an otherwise clean tree", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    const expected = sh(pair.work, "git", "rev-parse", "HEAD");
    commitFile(pair.work, "moved-on.txt");
    const result = prePushGuard(pair.work, { expectedCommit: expected, fetch: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expected HEAD");
  });
});

describe("AT-G1.3 — checkpoint round-trip + schema validation rejects malformed checkpoints", () => {
  it("write → read round-trips the full session state", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    bindWorkOrder(pair.work, "WO-G2");
    const written = writeCheckpoint(pair.work, { writtenAt: "2026-10-30T08:00:00.000Z" });
    const read = readCheckpoint(pair.work);
    expect(read).toEqual(written);
    expect(read.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(read.repositoryUrl).toBe(pair.origin);
    expect(read.branch).toBe("main");
    expect(read.dirtyFiles).toEqual([]);
    expect(read.openWorkOrders).toHaveLength(1);
    expect(read.openWorkOrders[0].id).toBe("WO-G2");
    expect(read.openWorkOrders[0].base).toBe(read.head);
  });

  it("dirty files and open work orders are captured in the checkpoint", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    bindWorkOrder(pair.work, "WO-P1");
    bindWorkOrder(pair.work, "WO-P5");
    writeFileSync(path.join(pair.work, "uncommitted.txt"), "wip\n");
    const checkpoint = writeCheckpoint(pair.work);
    expect(checkpoint.dirtyFiles).toContain("uncommitted.txt");
    expect(checkpoint.openWorkOrders.map((wo) => wo.id).sort()).toEqual(["WO-P1", "WO-P5"]);
  });

  it("validateCheckpoint rejects wrong schemaVersion, bad sha, non-array fields", () => {
    const good = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      repositoryUrl: "/tmp/origin.git",
      head: "a".repeat(40),
      branch: "main",
      dirtyFiles: [],
      openWorkOrders: [],
      writtenAt: "2026-10-30T08:00:00.000Z",
    };
    expect(validateCheckpoint(good).valid).toBe(true);
    expect(validateCheckpoint({ ...good, schemaVersion: 99 }).errors.join(" ")).toContain("schemaVersion");
    expect(validateCheckpoint({ ...good, head: "not-a-sha" }).errors.join(" ")).toContain("head");
    expect(validateCheckpoint({ ...good, dirtyFiles: "not-an-array" }).errors.join(" ")).toContain("dirtyFiles");
    expect(validateCheckpoint({ ...good, openWorkOrders: [{ id: "X" }] }).errors.join(" ")).toContain("openWorkOrders");
    expect(validateCheckpoint({ ...good, writtenAt: "yesterday" }).errors.join(" ")).toContain("writtenAt");
    expect(validateCheckpoint({ ...good, extraField: true }).errors.join(" ")).toContain("unknown field");
    expect(validateCheckpoint(null).valid).toBe(false);
  });

  it("readCheckpoint refuses malformed files: bad JSON and schema violations", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    const checkpointPath = path.join(pair.work, ".reset-guard", "checkpoint.json");
    mkdirSync(path.dirname(checkpointPath), { recursive: true });
    writeFileSync(checkpointPath, "{ not json", "utf8");
    expect(() => readCheckpoint(pair.work)).toThrow(/not valid JSON/);
    writeFileSync(checkpointPath, JSON.stringify({ schemaVersion: 1, head: 42 }, null, 2), "utf8");
    expect(() => readCheckpoint(pair.work)).toThrow(/malformed checkpoint/);
  });
});

describe("AT-G1.4 — simulated sandbox divergence produces a complete recovery event", () => {
  const recoveryEvent = (work) => {
    const comparison = compareWithRemote(work);
    return {
      detectedAt: "2026-10-30T09:30:00.000Z",
      localHead: comparison.localHead,
      remoteHead: comparison.remoteHead,
      divergenceSummary: `simulated sandbox reset: local ${comparison.relation}, ahead ${comparison.ahead}, behind ${comparison.behind} (remote commit remote-work.txt)`,
      decision: "completed remote state wins; no verified-additive local improvement exists",
      portedItems: "none",
      discardedWork: "none (the stale workspace held no local content changes)",
    };
  };

  it("records the event with all required fields and renders the registry row", () => {
    const { work } = makeStaleRepo();
    const { record, markdown } = recordRecoveryEvent(work, recoveryEvent(work));
    expect(record.id).toMatch(/^recon-/);
    expect(listReconciliations(work)).toHaveLength(1);
    for (const field of ["detectedAt", "localHead", "remoteHead", "divergenceSummary", "decision", "portedItems", "discardedWork"]) {
      expect(typeof record[field]).toBe("string");
      expect(record[field]).not.toBe("");
    }
    // the registry row carries every required field, labeled:
    expect(markdown).toContain("Detection time:");
    expect(markdown).toContain("Local state:");
    expect(markdown).toContain("remote state (`origin/main`)");
    expect(markdown).toContain("Divergence summary:");
    expect(markdown).toContain("Decision:");
    expect(markdown).toContain("Ported items:");
    expect(markdown).toContain("Discarded-work inventory:");
  });

  it("a recorded reconciliation unblocks the refused guards (the escape hatch is explicit)", () => {
    const { work } = makeStaleRepo();
    expect(preFlightCheck(work, { fetch: false }).ok).toBe(false);
    const { record } = recordRecoveryEvent(work, recoveryEvent(work));
    const flight = preFlightCheck(work, { fetch: false });
    expect(flight.ok).toBe(true);
    expect(flight.reconciled).toBe(true);
    expect(flight.reason).toContain(record.id);
    const push = prePushGuard(work, { fetch: false });
    expect(push.ok).toBe(true);
  });

  it("work-order base assertion passes when a reconciliation covers the old base", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    bindWorkOrder(pair.work, "WO-P1");
    advanceRemote(pair.root, pair.origin, "remote-work.txt");
    sh(pair.work, "git", "fetch", "origin");
    const comparison = compareWithRemote(pair.work);
    recordRecoveryEvent(pair.work, {
      detectedAt: "2026-10-30T10:00:00.000Z",
      localHead: comparison.localHead,
      remoteHead: comparison.remoteHead,
      divergenceSummary: "simulated divergence for the bound work order",
      decision: "remote wins for the test",
      portedItems: "none",
      discardedWork: "none",
    });
    // after reconciling (reset to remote), the order's old base is covered:
    sh(pair.work, "git", "reset", "--hard", "origin/main");
    const result = assertWorkOrderBase(pair.work, "WO-P1", { fetch: false });
    expect(result.ok).toBe(true);
    expect(result.reconciled).toBe(true);
  });

  it("Case A — the sandbox resets AWAY from the order's base; the record unblocks it", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    // origin advances to the true current state; the workspace adopts it and
    // accepts the order on that base.
    advanceRemote(pair.root, pair.origin, "remote-work.txt");
    sh(pair.work, "git", "fetch", "origin");
    sh(pair.work, "git", "reset", "--hard", "origin/main");
    const bound = bindWorkOrder(pair.work, "WO-P1");
    // the 2026-10-30 reset shape: the workspace rewinds BELOW the order's base
    const stale = sh(pair.work, "git", "rev-parse", "origin/main~1");
    simulateSandboxReset(pair.work);
    expect(sh(pair.work, "git", "rev-parse", "HEAD")).toBe(stale);
    expect(assertWorkOrderBase(pair.work, "WO-P1", { fetch: false }).ok).toBe(false);
    // recording the exact incident unblocks the order (Case A coverage)
    const comparison = compareWithRemote(pair.work);
    expect(comparison.localHead).toBe(stale);
    expect(comparison.remoteHead).toBe(bound.base);
    recordRecoveryEvent(pair.work, {
      detectedAt: "2026-10-30T10:30:00.000Z",
      localHead: stale,
      remoteHead: bound.base,
      divergenceSummary: "simulated 2026-10-30 incident: workspace rewound below the order's base",
      decision: "completed remote state wins",
      portedItems: "none",
      discardedWork: "none",
    });
    const result = assertWorkOrderBase(pair.work, "WO-P1", { fetch: false });
    expect(result.ok).toBe(true);
    expect(result.reconciled).toBe(true);
  });

  it("incomplete recovery events are rejected with the missing field named", () => {
    const { work } = makeStaleRepo();
    const event = recoveryEvent(work);
    const { decision, ...incomplete } = event;
    void decision;
    expect(() => recordRecoveryEvent(work, incomplete)).toThrow(/decision must be a non-empty string/);
    const { portedItems, ...missingPorted } = event;
    void portedItems;
    expect(() => recordRecoveryEvent(work, missingPorted)).toThrow(/portedItems/);
    expect(() => recordRecoveryEvent(work, { ...event, localHead: "short" })).toThrow(/localHead must be a full 40-char sha/);
    expect(listReconciliations(work)).toHaveLength(0);
  });
});

describe("AT-G1.5 — clean state passes silently with negligible overhead", () => {
  it("clean + in-sync: pre-flight and guard-push pass with EMPTY stdout (silent)", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    const flight = preFlightCheck(pair.work, { fetch: false });
    expect(flight.ok).toBe(true);
    expect(flight.reconciled).toBeUndefined();
    const push = prePushGuard(pair.work, { fetch: false });
    expect(push.ok).toBe(true);
    const cliFlight = tryRunCli(pair.work, "pre-flight");
    expect(cliFlight.status).toBe(0);
    expect(cliFlight.stdout).toBe("");
    const cliPush = tryRunCli(pair.work, "guard-push");
    expect(cliPush.status).toBe(0);
    expect(cliPush.stdout).toBe("");
  });

  it("the guard's own checkpoint state never dirties the tree or blocks a push", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    bindWorkOrder(pair.work, "WO-G1");
    writeCheckpoint(pair.work);
    // Raw git still reports the guard's own untracked state (the temp repo has no
    // .gitignore rule) — exactly why the guard must stay self-consistent anyway:
    expect(requireDirtyFiles(pair.work).some((f) => f.startsWith(".reset-guard"))).toBe(true);
    // ...and the guard's dirty-file view filters its own state directory, so a
    // session-start checkpoint can never block a later push:
    expect(listDirtyFiles(pair.work)).toEqual([]);
    const push = prePushGuard(pair.work, { fetch: false });
    expect(push.ok).toBe(true);
  });

  it("the full clean-path guard chain completes in well under a second per command", () => {
    const pair = makeRepoPair();
    commitFile(pair.work, "base.txt");
    sh(pair.work, "git", "push", "-u", "origin", "main");
    const started = process.hrtime.bigint();
    preFlightCheck(pair.work, { fetch: false });
    prePushGuard(pair.work, { fetch: false });
    bindWorkOrder(pair.work, "WO-G2");
    assertWorkOrderBase(pair.work, "WO-G2", { fetch: false });
    writeCheckpoint(pair.work);
    readCheckpoint(pair.work);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    // negligible overhead: the whole five-command chain in one process stays
    // far below one second (typical runs are a few milliseconds).
    expect(elapsedMs).toBeLessThan(1000);
  });
});

function requireDirtyFiles(work) {
  return execFileSync("git", ["status", "--porcelain=v1", "-z"], { cwd: work, encoding: "utf8" })
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => entry.slice(3));
}
