/**
 * Fallback model port (W3-2) — a production ModelPort (capability-routed real
 * models through the host provider system) wrapped with a labeled stand-in
 * fallback. Governance: docs/marketing/MARKETING-CAPABILITY-MAP.md.
 *
 * Routing honesty rules:
 * - The catalog/routing sees ONLY the primary port's declared capabilities:
 *   the stand-in is not a competing production capability (its own contract
 *   says so) and must never win a production route.
 * - If the primary channel fails (unavailable, declined, network, invalid
 *   output), the fallback runs and the record's provenance stamps BOTH the
 *   stand-in identity and the fallback reason: `heuristic:x (fallback: …)`.
 *   Substitution is visible in tool output, never silent.
 * - If both fail, the primary error surfaces (typed, no masking).
 *
 * Layer: adapters.
 */
import type { ModelCapability, ModelPort, ModelTask } from '../app/ports.js';

const MAX_FALLBACK_REASON_CHARS = 120;

const fallbackReason = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > MAX_FALLBACK_REASON_CHARS
    ? `${compact.slice(0, MAX_FALLBACK_REASON_CHARS)}…`
    : compact;
};

export class FallbackModelPort implements ModelPort {
  readonly capabilities: ModelCapability[];

  constructor(
    private readonly primary: ModelPort,
    private readonly fallback: ModelPort,
  ) {
    if (primary.capabilities.length === 0) {
      throw new Error('fallback model port needs a primary with declared capabilities');
    }
    this.capabilities = primary.capabilities;
  }

  async runStructured<T>(
    task: ModelTask,
    input: unknown,
    outputSchema: { parse: (v: unknown) => T },
  ): Promise<{ value: T; modelRef: string }> {
    try {
      return await this.primary.runStructured(task, input, outputSchema);
    } catch (primaryError) {
      let result: { value: T; modelRef: string };
      try {
        result = await this.fallback.runStructured(task, input, outputSchema);
      } catch (fallbackError) {
        // Both failed: surface the primary failure, keep the fallback error in
        // the cause chain — no silent masking of either.
        const error = new Error(
          `model task '${task}' failed on the primary channel: ${fallbackReason(primaryError)}; fallback also failed: ${fallbackReason(fallbackError)}`,
        );
        (error as { cause?: unknown }).cause = fallbackError;
        throw error;
      }
      return {
        value: result.value,
        modelRef: `${result.modelRef} (fallback: ${fallbackReason(primaryError)})`,
      };
    }
  }
}
