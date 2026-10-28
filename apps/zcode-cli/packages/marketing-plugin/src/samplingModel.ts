/**
 * McpSamplingModel (W3-2) — the production ModelPort for the marketing plugin:
 * structured extraction routed to the HOST's model system over the MCP
 * `sampling/createMessage` channel. No side-channel, no direct provider I/O —
 * the host resolves the session model through its provider registry, records
 * usage, and can decline (governance: docs/marketing/MARKETING-CAPABILITY-MAP.md
 * "Real-model bridge").
 *
 * Wire contract: the request/result shapes mirror `McpAppsSamplingParams` /
 * `McpAppsSamplingResult` from @zcode/shared/mcp-apps — the same zod contract
 * the host validates with. The plugin declares them structurally (module
 * boundary: marketing-plugin requires only @zcode/marketing); a mismatch
 * fails loudly at the host's validation, never silently.
 *
 * Provenance: the adapter returns modelRef `zcode:routed:<model>` where
 * <model> is the model name the host reported — the actual model that
 * produced the output, recorded per record (extractionModelRef).
 *
 * Layer: app (plugin adapter boundary — the MCP client call is I/O, it lives
 * here and never in @zcode/marketing domain code).
 */
import type { ModelCapability, ModelPort, ModelTask } from '@zcode/marketing';
import { z } from 'zod';

/** Structural mirror of the host's shared sampling wire contract (strict subset). */
export interface SamplingWireRequest {
  messages: Array<{
    role: 'user' | 'assistant';
    content: Array<{ type: 'text'; text: string }>;
  }>;
  systemPrompt?: string;
  maxTokens: number;
  modelPreferences?: {
    hints?: Array<{ name?: string }>;
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };
}
export interface SamplingWireResult {
  role: 'assistant';
  model: string;
  content: { type: 'text'; text: string } | Array<{ type: 'text'; text: string }>;
  stopReason: string;
}
/** Minimal client seam so tests inject deterministic responses. */
export interface SamplingClient {
  createMessage(request: SamplingWireRequest): Promise<SamplingWireResult>;
}

const TASK_PROFILE: Record<ModelTask, { maxTokens: number; preferences: NonNullable<SamplingWireRequest['modelPreferences']> }> = {
  classifyCaptions: {
    maxTokens: 2048,
    preferences: { costPriority: 0.9, speedPriority: 0.7, intelligencePriority: 0.4 },
  },
  extractCreativeFeatures: {
    maxTokens: 6144,
    preferences: { costPriority: 0.5, speedPriority: 0.4, intelligencePriority: 0.7 },
  },
  synthesizeStrategy: {
    maxTokens: 8192,
    preferences: { costPriority: 0.2, speedPriority: 0.2, intelligencePriority: 0.9 },
  },
  scoreOpportunity: {
    maxTokens: 2048,
    preferences: { costPriority: 0.6, speedPriority: 0.5, intelligencePriority: 0.6 },
  },
  draftBrief: {
    maxTokens: 4096,
    preferences: { costPriority: 0.4, speedPriority: 0.3, intelligencePriority: 0.7 },
  },
  validateAsset: {
    maxTokens: 2048,
    preferences: { costPriority: 0.3, speedPriority: 0.3, intelligencePriority: 0.8 },
  },
};

const SYSTEM_PROMPTS: Record<ModelTask, string> = {
  classifyCaptions:
    'You are the product & market researcher of a marketing intelligence system. ' +
    'Given a product brief (product, audience, offer) and competitor name hints, propose competitor candidates: ' +
    'which real, distinct brands/products compete for the same audience. Give each a relevance reason grounded in the brief ' +
    '(overlapping category, audience, or offer) and an identity confidence in [0,1]. Hints are user-provided names — echo them ' +
    'when plausible, but never invent market facts you cannot justify from the brief. Return STRICT JSON only.',
  extractCreativeFeatures:
    'You are a creative intelligence analyst in a marketing intelligence system. Extract the creative STRUCTURE of each ' +
    'observed subject: how it persuades, not what it depicts. For every subject: hooks (opening pattern and its attention ' +
    'mechanism, e.g. offer-led, identity-led, curiosity), narrative (ordered beats of the persuasion sequence), ' +
    'offerStructure (how value/price/urgency is framed), visualStructure (format and visual grammar). NEVER summarize content. ' +
    'subjectRef MUST echo the given subject id exactly. OUTPUT SHAPE: "features" MUST be a JSON ARRAY of objects, exactly one ' +
    'entry per given subject, in the same order — never an object keyed by id. If the metadata is genuinely insufficient to ' +
    'judge a field, say so plainly in that field (e.g. "insufficient metadata: transcript unavailable") instead of inventing. ' +
    'Return STRICT JSON only.',
  synthesizeStrategy:
    'You are a cross-source strategy analyst in a marketing intelligence system. Synthesize ranked creative opportunities ' +
    'from the paid (ad) and organic creative features and the product brief. Requirements: (1) every opportunity must cite ' +
    'adEvidence AND organicEvidence as subject ids drawn ONLY from the given inputs — no fabricated refs; (2) contradictedByRefs ' +
    'records honest coverage limits (e.g. missing ad source) rather than empty guesses; (3) predicted outcome ranges must be ' +
    'rough magnitude estimates for the stated objective with confidence in [0,1] reflecting evidence completeness, not model ' +
    'certainty; (4) the hook/message/format must be concretely different from what competitors already run. Return STRICT JSON only.',
  scoreOpportunity:
    'You are an opportunity scorer in a marketing intelligence system. Score the given creative hypothesis for the stated ' +
    'objective: a number in [0,1] plus a short rationale citing the attached evidence (paid duration/offer signals, organic ' +
    'velocity). Never blend unrelated signals; if evidence is thin say so and lower the score. Return STRICT JSON only.',
  draftBrief:
    'You are a creative strategist producing a production handoff brief. Given a creative hypothesis pattern (problem, ' +
    'message, hook, format, demonstration, cta), draft the storyboard: an ordered list of concrete shots/beats that a video ' +
    'generator or creator can execute. Honor the hypothesis exactly — do not soften or replace its claims. Return STRICT JSON only.',
  validateAsset:
    'You are an asset validation reviewer. Compare the produced asset against the brief and the brand constraints given in ' +
    'the input. Verdict is one of: pass, needs-review, reject. List concrete issues (claim without proof, constraint breach, ' +
    'missing CTA); never invent issues. Return STRICT JSON only.',
};

/** Declared production capabilities — honest per-task cost/reliability floors. */
const capabilities: ModelCapability[] = [
  { modelRef: 'zcode:host-routed', tasks: ['classifyCaptions'], relativeCost: 0.4, reliability: 0.8, structuredOutput: true },
  { modelRef: 'zcode:host-routed', tasks: ['extractCreativeFeatures'], relativeCost: 0.6, reliability: 0.85, structuredOutput: true },
  { modelRef: 'zcode:host-routed', tasks: ['synthesizeStrategy'], relativeCost: 0.8, reliability: 0.9, structuredOutput: true },
  { modelRef: 'zcode:host-routed', tasks: ['scoreOpportunity'], relativeCost: 0.6, reliability: 0.85, structuredOutput: true },
  { modelRef: 'zcode:host-routed', tasks: ['draftBrief'], relativeCost: 0.7, reliability: 0.85, structuredOutput: true },
  { modelRef: 'zcode:host-routed', tasks: ['validateAsset'], relativeCost: 0.6, reliability: 0.85, structuredOutput: true },
];

const jsonSchemaOf = (outputSchema: { parse: (v: unknown) => unknown }): string => {
  try {
    // Workflows pass real zod schemas; zod 4 can compile them to JSON Schema.
    return JSON.stringify(z.toJSONSchema(outputSchema as z.ZodType, { io: 'output' }));
  } catch {
    return 'JSON object matching the output shape described in the task instructions';
  }
};

const extractJsonPayload = (text: string): unknown => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/m.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('sampling response contained no JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1));
};

const resultText = (content: SamplingWireResult['content']): string => {
  if (Array.isArray(content)) {
    return content.map((b) => b.text).join('\n');
  }
  return content.text;
};

export class McpSamplingModel implements ModelPort {
  readonly capabilities = capabilities;

  constructor(private readonly client: SamplingClient) {}

  async runStructured<T>(
    task: ModelTask,
    input: unknown,
    outputSchema: { parse: (v: unknown) => T },
  ): Promise<{ value: T; modelRef: string }> {
    const profile = TASK_PROFILE[task];
    if (!profile) throw new Error(`sampling model has no task profile for '${task}'`);
    const systemPrompt =
      `${SYSTEM_PROMPTS[task]}\n\nOutput contract: return one JSON object that exactly satisfies this JSON Schema ` +
      `(no prose, no markdown, no trailing commentary):\n${jsonSchemaOf(outputSchema)}`;
    const userPayload = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: JSON.stringify(input, null, 1) }],
    };
    const first = await this.client.createMessage({
      messages: [userPayload],
      systemPrompt,
      maxTokens: profile.maxTokens,
      modelPreferences: profile.preferences,
    });
    if (first.stopReason === 'maxTokens') {
      throw new Error(`sampling for '${task}' stopped at maxTokens — output likely truncated`);
    }
    try {
      return { value: outputSchema.parse(extractJsonPayload(resultText(first.content))), modelRef: `zcode:routed:${first.model}` };
    } catch (validationError) {
      // One in-channel repair attempt BEFORE giving the task to the fallback:
      // real models occasionally mis-shape the JSON; asking them to fix their
      // own output against the reported schema errors keeps the routing
      // honest (still the same capability-routed channel). A second failure
      // throws and the labeled fallback runs with the reason recorded.
      const repair = await this.client.createMessage({
        messages: [
          userPayload,
          { role: 'assistant', content: [{ type: 'text', text: resultText(first.content) }] },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `Your previous answer failed the required schema: ${schemaErrorSummary(validationError)}\n` +
                  `Return the corrected STRICT JSON only — same task, fixed shape.`,
              },
            ],
          },
        ],
        systemPrompt,
        maxTokens: profile.maxTokens,
        modelPreferences: profile.preferences,
      });
      if (repair.stopReason === 'maxTokens') {
        throw new Error(`sampling for '${task}' repair attempt stopped at maxTokens`);
      }
      return {
        value: outputSchema.parse(extractJsonPayload(resultText(repair.content))),
        modelRef: `zcode:routed:${repair.model}`,
      };
    }
  }
}

const schemaErrorSummary = (error: unknown): string => {
  const raw =
    typeof (error as { issues?: unknown })?.issues === 'object' && Array.isArray((error as { issues: unknown[] }).issues)
      ? JSON.stringify((error as { issues: unknown[] }).issues)
      : error instanceof Error
        ? error.message
        : String(error);
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > 400 ? `${compact.slice(0, 400)}…` : compact;
};
