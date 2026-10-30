#!/usr/bin/env node
// WO-G1 reset-guard CLI. Exit codes: 0 = passed (silently — AT-G1.5),
// 1 = refused (report on stdout), 2 = usage or operational error (stderr).
//
// Commands:
//   pre-flight                    session-start gate (scope 1)
//   bind --wo <ID> [--base <sha>] work-order base binding (scope 2)
//   assert --wo <ID>              re-assert the base before any write (scope 2)
//   guard-push [--expect <sha>]   pre-push gate (scope 3)
//   checkpoint write|read        session/workspace checkpoint (scope 4)
//   record-recovery --input <json|@file>   recovery event + registry row (scope 5)
//   status                        human-readable state summary (always verbose)
//
// Common flags: --no-fetch (skip the origin fetch; the guards then judge the
// last-fetched refs — useful offline and inside the test suite).

import { readFileSync } from "node:fs";
import process from "node:process";
import {
  assertWorkOrderBase,
  bindWorkOrder,
  listReconciliations,
  listWorkOrderBindings,
  preFlightCheck,
  prePushGuard,
  readCheckpoint,
  recordRecoveryEvent,
  resolveRepoState,
  writeCheckpoint,
} from "./resetGuard.mjs";

const USAGE = `usage: node scripts/reset-guard/cli.mjs <command> [flags]
commands: pre-flight | bind | assert | guard-push | checkpoint | record-recovery | status
run with no arguments for the full help table (scripts/reset-guard/README.md)`;

function fail(message) {
  process.stderr.write(`reset-guard: ${message}\n`);
  process.exit(2);
}

function refuse(output) {
  process.stdout.write(`${output}\n`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const flagValue = (name) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
const noFetch = flags.has("--no-fetch");
const cwd = process.cwd();

switch (command) {
  case "pre-flight": {
    const result = preFlightCheck(cwd, { fetch: !noFetch });
    if (!result.ok) refuse(result.report);
    process.exit(0);
  }
  case "bind": {
    const id = flagValue("--wo");
    if (!id) fail("bind requires --wo <WORK-ORDER-ID>");
    const base = flagValue("--base");
    const binding = bindWorkOrder(cwd, id, { base: base ?? null });
    process.stdout.write(`bound ${binding.id} to base ${binding.base} at ${binding.boundAt}\n`);
    process.exit(0);
  }
  case "assert": {
    const id = flagValue("--wo");
    if (!id) fail("assert requires --wo <WORK-ORDER-ID>");
    const result = assertWorkOrderBase(cwd, id, { fetch: !noFetch });
    if (!result.ok) refuse(result.reason);
    if (result.reconciled) process.stdout.write(`${result.reason}\n`);
    process.exit(0);
  }
  case "guard-push": {
    const expect = flagValue("--expect");
    const result = prePushGuard(cwd, { expectedCommit: expect ?? null, fetch: !noFetch });
    if (!result.ok) {
      const lines = [result.reason, ...(result.offendingFiles ?? []).map((f) => `  - ${f}`)];
      refuse(lines.join("\n"));
    }
    process.exit(0);
  }
  case "checkpoint": {
    const sub = rest[0];
    if (sub === "write") {
      const checkpoint = writeCheckpoint(cwd);
      process.stdout.write(`${JSON.stringify(checkpoint, null, 2)}\n`);
      process.exit(0);
    }
    if (sub === "read") {
      try {
        const checkpoint = readCheckpoint(cwd);
        process.stdout.write(`${JSON.stringify(checkpoint, null, 2)}\n`);
        process.exit(0);
      } catch (error) {
        refuse(String(error.message ?? error));
      }
    }
    fail("checkpoint requires `write` or `read`");
  }
  case "record-recovery": {
    const input = flagValue("--input");
    if (!input) fail("record-recovery requires --input <json | @file>");
    let raw = input;
    if (input.startsWith("@")) raw = readFileSync(input.slice(1), "utf8");
    let event;
    try {
      event = JSON.parse(raw);
    } catch (error) {
      fail(`--input is not valid JSON: ${error.message}`);
    }
    const { record, markdown } = recordRecoveryEvent(cwd, event);
    process.stdout.write(`recorded ${record.id}\n`);
    process.stdout.write(`\nwork-registry change-log row (commit this into WORK-REGISTRY.md):\n`);
    process.stdout.write(`${markdown}\n`);
    process.exit(0);
  }
  case "status": {
    const state = resolveRepoState(cwd);
    const bindings = listWorkOrderBindings(cwd);
    const reconciliations = listReconciliations(cwd);
    process.stdout.write(`repository : ${state.repositoryUrl ?? "(no origin)"}\n`);
    process.stdout.write(`branch/HEAD: ${state.branch} @ ${state.head}\n`);
    process.stdout.write(`dirty files: ${state.dirtyFiles.length}\n`);
    state.dirtyFiles.slice(0, 20).forEach((f) => process.stdout.write(`  - ${f}\n`));
    if (state.dirtyFiles.length > 20) process.stdout.write(`  - … +${state.dirtyFiles.length - 20} more\n`);
    process.stdout.write(`open work orders: ${bindings.length}\n`);
    bindings.forEach((b) => process.stdout.write(`  - ${b.id} @ ${b.base.slice(0, 12)} (bound ${b.boundAt})\n`));
    process.stdout.write(`recorded reconciliations: ${reconciliations.length}\n`);
    reconciliations.forEach((r) => process.stdout.write(`  - ${r.id}: ${r.localHead.slice(0, 12)} → ${r.remoteHead.slice(0, 12)} (${r.decision})\n`));
    process.exit(0);
  }
  default:
    fail(command === undefined ? `missing command — ${USAGE}` : `unknown command ${JSON.stringify(command)} — ${USAGE}`);
}
