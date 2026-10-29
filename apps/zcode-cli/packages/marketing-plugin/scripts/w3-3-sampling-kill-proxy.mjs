// W3-3 real-host verification: a transparent OpenAI-compatible relay with a
// DETERMINISTIC sampling-kill switch — the honest way to exercise the real
// host's explicit fallback path.
//
// Forwarding rule: agent-loop requests (body carries `tools`) and any other
// request WITHOUT the sampling markers are relayed verbatim to the real GLM
// endpoint (streaming included). Any request whose body contains a sampling
// marker (the marketing plugin's structured-extraction system prompts all end
// with the distinctive phrase "Return STRICT JSON only.") is rejected with an
// OpenAI-shaped 503 — exactly what a real upstream outage looks like to the
// provider adapter. The host must surface that failure to the plugin as a
// sampling error, and the plugin must fall back to the labeled heuristic
// adapter with the reason stamped into provenance — never silently.
//
// Usage: node scripts/w3-3-sampling-kill-proxy.mjs --port 8642
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const readFlag = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
};
const port = Number(readFlag("--port") ?? "8642");

const service = JSON.parse(readFileSync("/etc/.z-ai-config", "utf8"));
const UPSTREAM = `${service.baseUrl}/chat/completions`;
const UPSTREAM_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer Z.ai",
  "X-Z-AI-From": "Z",
  "X-Token": service.token,
  "X-User-Id": service.userId,
};
const SAMPLING_MARKER = "Return STRICT JSON only";

let forwarded = 0;
let killed = 0;

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  if (!req.url || !req.url.includes("/chat/completions") || req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not a chat/completions route" } }));
    return;
  }
  if (body.includes(SAMPLING_MARKER)) {
    killed += 1;
    // 401 — a NON-retryable failure class (credential/permission), exactly like a
    // real expired-token upstream. 5xx/429 would make the provider adapter retry
    // with backoff and blow the host's 30s MCP tool budget before the labeled
    // fallback could engage — a fast, honest failure is what run B verifies.
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message:
            "Unauthorized: upstream credential rejected for this request class (deterministic sampling-kill for W3-3 fallback verification)",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      }),
    );
    return;
  }
  forwarded += 1;
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: UPSTREAM_HEADERS,
      body,
    });
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      ...(upstream.headers.get("content-type")?.includes("event-stream")
        ? { "Cache-Control": "no-cache", Connection: "keep-alive" }
        : {}),
    });
    if (upstream.body) {
      // Pipe SSE / JSON straight through — the relay never inspects content.
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `relay failure: ${String(error)}`, type: "server_error" } }));
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({ proxy: "listening", port, upstream: UPSTREAM, samplingMarker: SAMPLING_MARKER })}\n`,
  );
});

const shutdown = () => {
  process.stdout.write(`${JSON.stringify({ proxy: "stopped", forwarded, killed })}\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
