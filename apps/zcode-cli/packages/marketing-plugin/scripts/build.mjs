// Bundles the marketing plugin MCP server into dist/server.mjs.
// Mirrors the office-runtime plugin build: single ESM file, node platform,
// `node:sqlite` stays external as a Node builtin, everything else inlined.
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, ".."); // plugin package root
const dist = join(target, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [join(here, "..", "src", "main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "none",
  metafile: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
  logOverride: { "direct-eval": "silent" },
});

const inputs = Object.keys(result.metafile.inputs);
const bytes = Object.entries(result.metafile.outputs)
  .filter(([name]) => name.endsWith("server.mjs"))
  .map(([, out]) => `${(out.bytes / 1024).toFixed(0)} KiB`)
  .join(", ");
process.stdout.write(`marketing plugin server.mjs bundled from ${inputs.length} modules (${bytes})\n`);

// The plugin manifest and skills travel with the package (seeded at install);
// copy the LICENSE reference so the dist is self-describing.
await cp(join(target, "..", "..", "..", "..", "LICENSE"), join(dist, "LICENSE")).catch(() => {});
