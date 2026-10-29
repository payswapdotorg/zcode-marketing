/**
 * W6 tools — measurement and closed-loop learning (see docs/marketing/
 * MARKETING-ROADMAP.md W6): open the measurement window after a publication,
 * collect PERMITTED connected-account analytics into the temporal store
 * (idempotent ingest, coverage verbatim), and record the observed outcome
 * against the PRESERVED forecast — producing the comparison, the appended
 * calibration entry, and the next-experiment recommendation grounded in the
 * recorded result.
 *
 * Honesty rules encoded here:
 *   - the forecast is compared verbatim, never rewritten (forecastPreserved);
 *   - when the outcome was observed on a PROXY metric (the objective metric is
 *     not observable through permitted analytics), the comparison carries the
 *     [PROXY] label and never reports itself as the objective metric;
 *   - connected-account analytics require a publishing connection — manual
 *     publications record user-observed outcomes through the same
 *     completeExperiment discipline, labeled with the source note;
 *   - calibration history is APPENDED, never overwritten.
 */
import { z } from 'zod';
import { coverageState, evidenceRef, experimentRecord, metricObservation, nextAction, simulationRun } from '@zcode/marketing';
import type { NextAction } from '@zcode/marketing';
import { MarketingToolError, type MarketingRuntime } from './runtime.js';
import type { ToolRegistrar } from './toolRegistrar.js';

const comparisonShape = z.object({
  observedMetricKey: z.string(),
  isProxy: z.boolean(),
  withinForecastRange: z.boolean().nullable(),
  direction: z.enum(['above', 'below', 'within', 'unknown']),
  forecastErrorRatio: z.number().nullable(),
  note: z.string(),
});

/** Coverage slices travel verbatim (W6 analytics honesty). */
const coverageSliceShape = z.object({
  slice: z.string(),
  state: coverageState,
  sourceId: z.string(),
  connectorVersion: z.string(),
  region: z.string().optional(),
  dateWindow: z.string().optional(),
  note: z.string(),
});

export function registerW6Tools(register: ToolRegistrar, runtime: MarketingRuntime): void {
  // ---------------------------------------------------------------
  // W6 — Measurement window. Opens AFTER a publication exists; the
  // experiment tests exactly what the W4 pack's experimentSpec declared
  // (changed variables + window days), against the hypothesis's PRESERVED
  // forecast. One measurement window per publication — a re-open is the
  // same experiment, not a new one.
  // ---------------------------------------------------------------
  register(
    'marketing_open_experiment',
    {
      description:
        'Open the measurement window for a publication (W6): the experiment binds the publication to its hypothesis, inherits the changed variables and window from the artifact\'s W4 experiment spec, and preserves the hypothesis forecast VERBATIM for the later comparison. One experiment per publication — re-opening returns the same experiment.',
      input: {
        missionId: z.string().min(1),
        publicationId: z.string().min(1),
      },
      output: { experiment: experimentRecord },
      readOnly: false,
      panel: true,
    },
    async (input) => {
      const loaded = await runtime.open(input.missionId);
      const publication = await runtime.getPublication(input.missionId, input.publicationId);
      const existing = loaded.artifacts.experiments.find((e) => e.publicationId === publication.id);
      if (existing) {
        const text = [
          `Experiment ${existing.id} already measures publication ${publication.id} — idempotent re-open, no new window.`,
          existing.result
            ? `already completed: ${existing.result.observedValue} observed on ${existing.result.observedMetricKey} (completed ${existing.result.completedAt}).`
            : `measuring: goal metric '${existing.goalMetricKey}', window ${existing.measurementWindowDays}d, changed variables: ${existing.changedVariables.join(', ')}.`,
        ].join('\n');
        return { text, structured: { experiment: existing } };
      }
      const artifact = await runtime.getArtifact(input.missionId, publication.artifactId);
      const hypothesis = loaded.artifacts.hypotheses.find((h) => h.id === artifact.hypothesisId);
      if (!hypothesis) {
        throw new MarketingToolError(
          'unknown_hypothesis',
          `hypothesis '${artifact.hypothesisId}' (the forecast this experiment must preserve) is not in the mission artifacts — rank opportunities and draft the creative first`,
        );
      }
      const experiment = loaded.mission.openExperiment(hypothesis, artifact, publication);
      await runtime.saveExperiment(input.missionId, experiment);
      const forecast = hypothesis.predictedOutcome;
      const text = [
        `Measurement window open: experiment ${experiment.id} on publication ${publication.id} (${publication.externalPostId ?? publication.url ?? 'assisted'}).`,
        `goal metric: ${experiment.goalMetricKey} | changed variables: ${experiment.changedVariables.join(', ')} | window: ${experiment.measurementWindowDays} days.`,
        `PRESERVED forecast (verbatim, compared later): low ${forecast.low} / expected ${forecast.expected} / high ${forecast.high} on '${forecast.metricKey}'.`,
        'Next: collect permitted analytics with marketing_collect_analytics (connected account), then record the outcome with marketing_record_outcome.',
      ].join('\n');
      return { text, structured: { experiment } };
    },
  );

  // ---------------------------------------------------------------
  // W6 — Permitted analytics collection. Connected-account only (the
  // connector capability is the enforcement); observations land in the
  // temporal store through the SAME idempotent ingest as research metrics,
  // and coverage slices travel verbatim.
  // ---------------------------------------------------------------
  register(
    'marketing_collect_analytics',
    {
      description:
        'Collect permitted connected-account analytics for a publication (W6): daily metric totals through the connected account (YouTube Analytics API v2 shapes), ingested idempotently into the mission\'s temporal store with the connector\'s coverage slices verbatim. Requires a connected publishing account (marketing_connect_publish_account) — manual publications have no connected-account analytics; record their outcome from what you can observe and cite the source in marketing_record_outcome.',
      input: {
        missionId: z.string().min(1),
        publicationId: z.string().min(1),
        metrics: z
          .array(z.string().min(1))
          .default(['views'])
          .describe('Analytics API metric names, e.g. views, estimatedMinutesWatched, likes.'),
      },
      output: {
        observations: z.array(metricObservation),
        coverage: z.array(coverageSliceShape),
        latest: z.array(
          z.object({ metricKey: z.string(), value: z.number(), observedAt: z.string() }),
        ),
      },
      readOnly: false,
      panel: true,
    },
    async (input) => {
      const loaded = await runtime.open(input.missionId);
      const publication = await runtime.getPublication(input.missionId, input.publicationId);
      if (!publication.externalPostId) {
        throw new MarketingToolError(
          'coverage_gap',
          `publication ${publication.id} has no connected-account post id — it was published manually (assisted path); connected-account analytics need a publishing connection (marketing_connect_publish_account). Record the outcome from what you can observe, with marketing_record_outcome`,
        );
      }
      if (!loaded.connector.analytics) {
        throw new MarketingToolError(
          'auth_required',
          'no connected analytics source for this platform — connect the publishing account with marketing_connect_publish_account; for manual publications record the observed outcome with marketing_record_outcome',
        );
      }
      const from = publication.publishedAt.slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const page = await loaded.connector.analytics({
        missionId: input.missionId,
        subjectExternalIds: [publication.externalPostId],
        metrics: input.metrics,
        from,
        to,
      });
      const audit = loaded.mission.store.ingestMetrics(page.observations, new Date().toISOString());
      const subjectRef = `yt:${publication.externalPostId}`;
      const latest = input.metrics
        .map((metricKey) => {
          const obs = loaded.mission.store.latestObservation(metricKey, subjectRef, new Date().toISOString());
          return obs ? { metricKey, value: obs.value, observedAt: obs.observedAt } : undefined;
        })
        .filter((o): o is { metricKey: string; value: number; observedAt: string } => o !== undefined);
      const text = [
        `Connected-account analytics for publication ${publication.id} (${subjectRef}), window ${from}..${to}:`,
        `- ${page.observations.length} daily observations ingested (${audit.acceptedMetrics} accepted, ${audit.duplicatesIgnored} duplicates ignored — idempotent ingest).`,
        ...latest.map((o) => `- latest ${o.metricKey} = ${o.value} (observed ${o.observedAt})`),
        page.coverage.length > 0
          ? `coverage (verbatim): ${page.coverage.map((c) => `${c.state}: ${c.note.slice(0, 100)}`).join(' | ')}`
          : 'coverage: none reported',
        'Record the outcome against the preserved forecast with marketing_record_outcome.',
      ].join('\n');
      return {
        text,
        structured: {
          observations: page.observations,
          coverage: page.coverage,
          latest,
        },
      };
    },
  );

  // ---------------------------------------------------------------
  // W6 — Closed-loop learning. The observed outcome is compared against
  // the PRESERVED forecast: supported/contradicted assumptions, the
  // appended calibration entry, and the next-experiment recommendation
  // grounded in the recorded result. Proxy observations are labeled.
  // ---------------------------------------------------------------
  register(
    'marketing_record_outcome',
    {
      description:
        'Record the observed outcome of an experiment (W6 closed-loop gate): compares the value against the PRESERVED forecast (verbatim, never rewritten), keeps supported elements, names the weakest contradicted assumption, appends the calibration entry (never overwritten), and produces the next-experiment recommendation grounded in the recorded result. When the outcome was observed on a PROXY metric (the goal metric is not observable), say so through observedMetricKey AND declare the proxy baseline through proxyForecast — the comparison carries the [PROXY] label and never claims the objective metric.',
      input: {
        missionId: z.string().min(1),
        experimentId: z.string().min(1),
        observedValue: z.number().describe('The value actually observed for the measurement.'),
        observedMetricKey: z
          .string()
          .min(1)
          .optional()
          .describe('Metric the value was observed on; defaults to the experiment goal metric. Use for PROXY observations — then proxyForecast is required (the proxy is never silently compared against the goal metric range).'),
        proxyForecast: z
          .object({ low: z.number(), expected: z.number(), high: z.number() })
          .optional()
          .describe('The baseline you declared for the PROXY metric (low/expected/high on that metric) — required whenever observedMetricKey differs from the goal metric.'),
        sourceNote: z
          .string()
          .max(500)
          .optional()
          .describe('How the value was observed (connected-account analytics / platform UI / user-attested) — recorded with the comparison.'),
      },
      output: {
        result: experimentRecord,
        simulation: simulationRun,
        nextAction,
        comparison: comparisonShape,
      },
      readOnly: false,
      panel: true,
    },
    async (input) => {
      const loaded = await runtime.open(input.missionId);
      const experiment = await runtime.getExperiment(input.missionId, input.experimentId);
      if (experiment.result) {
        throw new MarketingToolError(
          'invalid_input',
          `experiment ${experiment.id} already completed (${experiment.result.observedValue} on ${experiment.result.observedMetricKey}, ${experiment.result.completedAt}) — one outcome per experiment; the next experiment comes from the recorded next-action recommendation`,
        );
      }
      const hypothesis = loaded.artifacts.hypotheses.find((h) => h.id === experiment.hypothesisId);
      if (!hypothesis) {
        throw new MarketingToolError(
          'unknown_hypothesis',
          `hypothesis '${experiment.hypothesisId}' (the preserved forecast source) is not in the mission artifacts — the comparison requires the verbatim forecast`,
        );
      }
      const forecast = hypothesis.predictedOutcome;
      const observedKey = input.observedMetricKey ?? experiment.goalMetricKey;
      if (observedKey !== experiment.goalMetricKey && !input.proxyForecast) {
        throw new MarketingToolError(
          'invalid_input',
          `observing on '${observedKey}' (a PROXY for the goal metric '${experiment.goalMetricKey}') requires the proxyForecast baseline (low/expected/high on '${observedKey}') — a proxy value is never silently compared against the goal metric's range (different units)`,
        );
      }
      const comparedForecast =
        observedKey === experiment.goalMetricKey
          ? { low: forecast.low, expected: forecast.expected, high: forecast.high, metricKey: forecast.metricKey }
          : { ...(input.proxyForecast ?? { low: 0, expected: 0, high: 0 }), metricKey: observedKey };
      const { result, simulation, action, comparison } = await loaded.mission.completeExperiment(
        experiment,
        input.observedValue,
        {
          observedMetricKey: observedKey,
          forecast: comparedForecast,
        },
      );
      // The observation's source travels as evidence on the recorded next
      // action — "how was this value observed" is part of the audit trail.
      const actionWithSource: NextAction = input.sourceNote
        ? nextAction.parse({
            ...action,
            evidence: [
              ...action.evidence,
              evidenceRef.parse({
                ref: `outcome-source:${experiment.id}`,
                accessMethod: 'authorizedAccount',
                observedAt: new Date().toISOString(),
                supports: `observation source for the recorded outcome: ${input.sourceNote}`,
              }),
            ],
          })
        : action;
      await runtime.saveExperiment(input.missionId, result);
      await runtime.saveSimulation(input.missionId, simulation);
      await runtime.saveNextAction(input.missionId, actionWithSource);
      const text = [
        `Outcome recorded for experiment ${experiment.id}: observed ${input.observedValue} on '${comparison.observedMetricKey}'${comparison.isProxy ? ' [PROXY — never reported as the objective metric]' : ''}.`,
        `comparison: ${comparison.note}`,
        `calibration: ${simulation.calibrationHistory.at(-1)?.note ?? 'n/a'} (appended to history — never overwritten).`,
        `next experiment: ${action.recommendation}`,
        input.sourceNote ? `source: ${input.sourceNote}` : 'source: (not stated — record where the value came from on the next outcome)',
        'The recorded recommendation grounds the next draft (marketing_draft_creative) — the loop closes.',
      ].join('\n');
      return {
        text,
        structured: {
          result,
          simulation,
          nextAction: actionWithSource,
          comparison,
        },
      };
    },
  );
}
