// W3-3 real-host verification: seed the sandbox ZCode personal provider config
// with a REAL OpenAI-compatible GLM provider, so the actual CLI host
// (`zcode agent-server` + provider registry + sampleModel) can execute the
// marketing sampling chain against a real model with real credentials-path
// wiring (personal provider_config.json — the same mechanism the desktop
// product uses for user-added providers).
//
// Usage (run with tsx so workspace TS packages resolve):
//   ZCODE_DATA_BASE_DIR=<sandbox> pnpm exec tsx scripts/w3-3-seed-personal-provider.mts \
//     --base-url https://internal-api.z.ai/v1
//
// The GLM endpoint credentials (static bearer + session token headers) are read
// from /etc/.z-ai-config — the sandbox's own provisioned AI service. They are
// written into the sandbox-isolated provider config only, never into the repo.
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelOptionSpecsConfig,
  ModelPropertiesConfig,
  ProviderApiConfig,
  ProviderConfig,
} from "@zcode/provider";
import { NodePersonalProviderConfigRepository } from "@zcode/provider-node";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";

export const W33_PROVIDER_ID = "zai-sandbox-glm";
export const W33_MODEL_ID = "glm-4-plus";
export const W33_SANDBOX_PROVIDER_NAME = "Z.ai Sandbox GLM (W3-3 verification)";

function parseArgs(argv: string[]): { baseUrl: string; dataBaseDir: string } {
  const args = argv.slice(2);
  const read = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const baseUrl = read("--base-url");
  const dataBaseDir =
    read("--data-base-dir") ??
    process.env.ZCODE_DATA_BASE_DIR?.trim() ??
    "";
  if (!baseUrl) throw new Error("--base-url is required (OpenAI-compatible chat/completions root)");
  if (!dataBaseDir) throw new Error("--data-base-dir or ZCODE_DATA_BASE_DIR is required (sandbox isolation)");
  return { baseUrl, dataBaseDir };
}

/** The sandbox's provisioned GLM service credentials — injected as provider headers. */
function readGlmServiceHeaders(): Record<string, string> {
  const configPath = "/etc/.z-ai-config";
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`sandbox GLM service config not found at ${configPath}`);
  }
  const config = JSON.parse(raw) as { token?: string; userId?: string };
  if (!config.token || !config.userId) {
    throw new Error("sandbox GLM service config lacks token/userId");
  }
  return {
    "X-Z-AI-From": "Z",
    "X-Token": config.token,
    "X-User-Id": config.userId,
  };
}

function buildModelConfig(): ModelConfig {
  // Mirrors the desktop E2E custom-provider fixture (proven shape for the
  // openai-chat-completions adapter through the real agent loop).
  return new ModelConfig({
    enabled: true,
    properties: new ModelPropertiesConfig({
      requiresMfjsToolSchema: false,
      contextWindow: 128_000,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
    }),
    optionSpecs: new ModelOptionSpecsConfig({
      reasoningLevel: { values: ["disabled"], map: "{}" },
      maxOutputTokens: { max: 16_000, map: '{"max_tokens":maxOutputTokens}' },
    }),
  });
}

async function main(): Promise<void> {
  const { baseUrl, dataBaseDir } = parseArgs(process.argv);
  const filePath = resolve(dataBaseDir, ".zcode", "v2", "provider_config.json");
  mkdirSync(dirname(filePath), { recursive: true });

  const providerConfig = new ProviderConfig({
    group: "standard-personal",
    access: new ApiKeyAccessConfig({ apiKey: "Z.ai" }),
    api: new ProviderApiConfig({
      type: "openai-chat-completions",
      baseUrl,
      headers: readGlmServiceHeaders(),
    }),
    personalModelIds: [W33_MODEL_ID],
  });

  const repository = new NodePersonalProviderConfigRepository({
    filePath,
    pollingIntervalMs: false,
  });
  try {
    const updated = await repository.update((current) => ({
      ...current,
      providers: current.providers.setRule({
        providerId: W33_PROVIDER_ID,
        providerName: W33_SANDBOX_PROVIDER_NAME,
        config: providerConfig,
      }),
      models: current.models.setExact(W33_PROVIDER_ID, W33_MODEL_ID, buildModelConfig()),
      defaultModelSelection: {
        providerId: W33_PROVIDER_ID,
        modelId: W33_MODEL_ID,
        options: { reasoningLevel: "disabled" },
      },
    }));
    console.log(
      JSON.stringify(
        {
          seeded: true,
          filePath,
          providerId: W33_PROVIDER_ID,
          modelId: W33_MODEL_ID,
          baseUrl,
          personalProviderCount: updated.providers.entries().length,
        },
        null,
        2,
      ),
    );
  } finally {
    repository.dispose();
  }
}

await main().catch((error: unknown) => {
  console.error(String(error));
  process.exit(1);
});
