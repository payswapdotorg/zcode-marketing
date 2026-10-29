// Bundles the marketing plugin MCP server into dist/server.mjs and the
// workspace panel into dist/panel.html.
// Mirrors the office-runtime plugin builds: the server is a single ESM file,
// node platform, `node:sqlite` external as a Node builtin, everything else
// inlined. The panel (W3-4) is one self-contained HTML resource: a browser
// IIFE of ui/panel.ts (the MCP Apps client + the panel app, no React) plus
// ui/panel.css, inlined into a minimal shell — served as ui://marketing/panel.html.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Panel (W3-4): one self-contained HTML resource, served at
// ui://marketing/panel.html. The page is dependency-light on purpose — the
// MCP Apps client + the whole workbench are a single IIFE inlined into the
// shell, with the stylesheet in a <style> tag. It must stay well below the
// host's per-read resource limit (office panels split at 4 MiB; ours is far
// smaller). `</script` sequences inside the bundle are escaped so the inline
// script tag cannot be closed early (same guard as the office build).
// ---------------------------------------------------------------------------
const panelBundle = await build({
  entryPoints: [join(here, "..", "ui", "panel.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  logOverride: { "direct-eval": "silent" },
});
const panelJs = panelBundle.outputFiles[0].text;
const panelCss = await readFile(join(here, "..", "ui", "panel.css"), "utf8");
const panelHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Marketing Intelligence</title>
    <style>${panelCss}</style>
  </head>
  <body>
    <div id="root"><div class="loading"><div class="spin"></div>Loading…</div></div>
    <script>${panelJs.replaceAll("</script", "<\\/script")}<\/script>
  </body>
</html>
`;
if (Buffer.byteLength(panelHtml) >= 4 * 1024 * 1024)
  throw new Error("marketing panel.html exceeds the 4 MiB resource budget");
await writeFile(join(dist, "panel.html"), panelHtml);
process.stdout.write(
  `marketing plugin panel.html bundled (${(Buffer.byteLength(panelHtml) / 1024).toFixed(0)} KiB)\n`,
);

// The plugin manifest and skills travel with the package (seeded at install);
// copy the LICENSE reference so the dist is self-describing.
await cp(join(target, "..", "..", "..", "..", "LICENSE"), join(dist, "LICENSE")).catch(() => {});
