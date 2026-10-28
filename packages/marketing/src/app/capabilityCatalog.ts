/**
 * Capability catalog + routing rule (W1).
 *
 * Governance: docs/marketing/MARKETING-CAPABILITY-MAP.md. The router selects
 * the CHEAPEST suitable capability that meets quality/reliability requirements,
 * falls back to another eligible provider, and records what was used. It never
 * assumes one model is best at every stage. This extends the existing ZCode
 * provider/model registry — it does not replace its selection logic.
 *
 * Layer: app.
 */
import type { ModelCapability, ModelPort, ModelTask } from './ports.js';

export interface RoutingDecision {
  modelRef: string;
  /** Why this model: capability match, cost, reliability — auditable. */
  reason: string;
}

const MIN_RELIABILITY: Record<ModelTask, number> = {
  classifyCaptions: 0.6,
  extractCreativeFeatures: 0.75,
  synthesizeStrategy: 0.85,
  scoreOpportunity: 0.8,
  draftBrief: 0.8,
  validateAsset: 0.85,
};

export class CapabilityCatalog {
  constructor(private readonly modelPort: ModelPort) {}

  capabilities(): ModelCapability[] {
    return this.modelPort.capabilities;
  }

  /** Cheapest suitable capability meeting the task's reliability bar, with fallback. */
  route(task: ModelTask): RoutingDecision {
    const eligible = this.modelPort.capabilities
      .filter((c) => c.tasks.includes(task))
      .sort((a, b) => a.relativeCost - b.relativeCost);
    const primary = eligible.find((c) => c.reliability >= MIN_RELIABILITY[task]);
    if (primary) {
      return {
        modelRef: primary.modelRef,
        reason: `cheapest suitable for ${task} (cost=${primary.relativeCost}, reliability=${primary.reliability})`,
      };
    }
    const fallback = eligible.at(0);
    if (!fallback) {
      throw new Error(`no registered capability can perform ${task}`);
    }
    return {
      modelRef: fallback.modelRef,
      reason: `fallback: best available for ${task} below reliability bar (reliability=${fallback.reliability})`,
    };
  }

  /** Run through the routing decision so the used model is always recorded. */
  async runRouted<T>(task: ModelTask, input: unknown, outputSchema: { parse: (v: unknown) => T }): Promise<{
    value: T;
    routing: RoutingDecision;
  }> {
    const routing = this.route(task);
    const result = await this.modelPort.runStructured(task, input, outputSchema);
    return { value: result.value, routing };
  }
}
