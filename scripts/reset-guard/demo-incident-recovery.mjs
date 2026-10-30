// WO-G1 evidence demo — the simulated integration run required by the work
// order's evidence clause: guard-suite output (unit plus a simulated
// integration run), the checkpoint JSON schema, and one sample recovery-event
// registry entry.
//
// This script replays the EXACT shape of the 2026-10-30 incident (twice
// occurred) in a throwaway repository: a workspace rewound to an old commit
// while origin/main already holds the completed state — then walks the full
// guard protocol end to end:
//
//   1. pre-flight refuses the stale base and prints the divergence report
//   2. the work-order base assertion refuses on the rewound workspace
//   3. record-recovery validates + persists the reconciliation and renders
//      the registry change-log row
//   4. the recorded reconciliation unblocks the guards (escape hatch)
//   5. reset to the completed remote state, bind, checkpoint write/read
//   6. the clean path passes silently (AT-G1.5)
//
// Reproduce: node scripts/reset-guard/demo-incident-recovery.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertWorkOrderBase,
  bindWorkOrder,
  preFlightCheck,
  readCheckpoint,
  recordRecoveryEvent,
  writeCheckpoint,
} from "./resetGuard.mjs";

const sh = (cwd, command, ...args) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], // keep progress noise out of evidence transcripts
  }).trim();

const section = (title) => console.log(`\n=== ${title} ===`);

const root = mkdtempSync(path.join(tmpdir(), "reset-guard-demo-"));
try {
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  mkdirSync(origin);
  sh(root, "git", "init", "--bare", "-b", "main", origin);
  sh(root, "git", "clone", origin, work);
  sh(work, "git", "config", "user.email", "demo@example.test");
  sh(work, "git", "config", "user.name", "Reset Guard Demo");

  // ---- the pre-incident state: workspace and origin in sync ----------------
  writeFileSync(path.join(work, "wave-deliverable.txt"), "shipped W0..W7\n");
  sh(work, "git", "add", "wave-deliverable.txt");
  sh(work, "git", "commit", "-m", "the completed waves");
  sh(work, "git", "push", "-u", "origin", "main");

  // The completed state advances on origin (the "second authoring session"
  // pushing the finished work) — then THE SANDBOX RESET: the local workspace
  // rewinds to the old commit while origin/main already holds the completed
  // implementation.
  const feeder = path.join(root, "feeder");
  sh(root, "git", "clone", origin, feeder);
  sh(feeder, "git", "config", "user.email", "feeder@example.test");
  sh(feeder, "git", "config", "user.name", "Remote Feeder");
  writeFileSync(path.join(feeder, "hardening.txt"), "shipped hardening\n");
  sh(feeder, "git", "add", "hardening.txt");
  sh(feeder, "git", "commit", "-m", "shipped hardening on origin");
  sh(feeder, "git", "push", "origin", "main");
  rmSync(feeder, { recursive: true, force: true });
  sh(work, "git", "fetch", "origin");
  const completedRemote = sh(work, "git", "rev-parse", "origin/main");

  section(`incident state: local HEAD rewound; origin/main already at ${completedRemote.slice(0, 12)}`);
  sh(work, "git", "reset", "--hard", "origin/main~1");
  const staleLocal = sh(work, "git", "rev-parse", "HEAD");
  console.log(`local HEAD     : ${staleLocal}`);
  console.log(`origin/main    : ${completedRemote}`);

  section("1. session-start pre-flight REFUSES the stale base (divergence report)");
  const refused = preFlightCheck(work, { fetch: false });
  console.log(refused.ok ? "UNEXPECTED PASS" : refused.report);

  section("2. work-order base assertion refuses on the rewound workspace");
  bindWorkOrder(work, "WO-G1", { base: completedRemote });
  const refusedOrder = assertWorkOrderBase(work, "WO-G1", { fetch: false });
  console.log(refusedOrder.ok ? "UNEXPECTED PASS" : refusedOrder.reason);

  section("3. record-recovery validates the event and renders the registry row");
  const comparison = {
    localHead: staleLocal,
    remoteHead: completedRemote,
  };
  const { record, markdown } = recordRecoveryEvent(work, {
    detectedAt: "2026-10-30T09:30:00.000Z",
    ...comparison,
    divergenceSummary:
      "simulated 2026-10-30 incident shape: workspace reset to an old commit while origin/main held the completed implementation; local behind by 1 (shipped hardening on origin), no local content changes",
    decision:
      "completed remote state wins (no verified-additive local improvement exists)",
    portedItems: "none",
    discardedWork: "none — the rewound workspace held no local content changes",
  });
  console.log(`recorded: ${record.id}`);
  console.log("\nregistry change-log row (commit into WORK-REGISTRY.md):");
  console.log(markdown);

  section("4. the recorded reconciliation unblocks the guards (explicit escape hatch)");
  const afterRecord = preFlightCheck(work, { fetch: false });
  console.log(afterRecord.ok ? `pre-flight: PASS (${afterRecord.reason})` : "UNEXPECTED REFUSAL");
  const afterRecordOrder = assertWorkOrderBase(work, "WO-G1", { fetch: false });
  console.log(afterRecordOrder.ok ? `assert WO-G1: PASS (${afterRecordOrder.reason})` : "UNEXPECTED REFUSAL");

  section("5. reconcile to the completed remote state, bind, checkpoint round-trip");
  sh(work, "git", "reset", "--hard", "origin/main");
  bindWorkOrder(work, "WO-G2");
  const checkpoint = writeCheckpoint(work, { writtenAt: "2026-10-30T11:00:00.000Z" });
  console.log("checkpoint written (schema v" + checkpoint.schemaVersion + "):");
  console.log(JSON.stringify(checkpoint, null, 2));
  console.log("\ncheckpoint read round-trip: " + (JSON.stringify(readCheckpoint(work)) === JSON.stringify(checkpoint) ? "OK" : "MISMATCH"));

  section("6. clean state: guards pass SILENTLY (AT-G1.5) — no output above the PASS lines");
  const cleanFlight = preFlightCheck(work, { fetch: false });
  const cleanPush = prePushGuardQuiet(work);
  console.log(`pre-flight exit: ${cleanFlight.ok ? 0 : 1} (report: ${cleanFlight.report ?? "SILENT"})`);
  console.log(`guard-push exit: ${cleanPush.status} (stdout: ${JSON.stringify(cleanPush.stdout)})`);

  section("DEMO COMPLETE — all six protocol steps executed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function prePushGuardQuiet(work) {
  // prePushGuard returns {ok} only; demonstrate the CLI's silent-pass contract
  // (exit 0, empty stdout) the way the evidence file quotes it.
  try {
    const stdout = execFileSync(
      "node",
      [path.resolve(path.dirname(new URL(import.meta.url).pathname), "cli.mjs"), "guard-push", "--no-fetch"],
      { cwd: work, encoding: "utf8" },
    );
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? "") };
  }
}
