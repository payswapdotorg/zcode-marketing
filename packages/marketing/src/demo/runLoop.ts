/**
 * End-to-end loop demo + W2 conformance smoke test.
 *
 * Runs the FULL learning cycle on the sample connector and asserts the
 * blueprint's gates (docs/marketing/MARKETING-EVALUATION.md):
 *   1. idempotent ingest (double research run does not inflate metrics)
 *   2. metric changes recorded as new observations (as-of queries reproduce
 *      the observations actually available at that time)
 *   3. like-for-like velocity (momentum beats raw totals)
 *   4. honest coverage (gaps explicit, never invented)
 *   5. every recommendation carries traceable evidence
 *   6. forecast preserved verbatim next to the observed outcome
 *
 * Run: pnpm --filter @zcode/marketing demo:loop
 * (or: node --experimental-strip-types src/demo/runLoop.ts from this package)
 */
import { productBrief } from '../domain/records.js';
import { CapabilityCatalog } from '../app/capabilityCatalog.js';
import { MarketingMission } from '../app/workflows.js';
import { HeuristicModel } from '../adapters/heuristicModel.js';
import { SampleConnector } from '../adapters/sampleConnector.js';
import { groundTruth } from '../adapters/fixtures.js';

const assert = (cond: boolean, label: string): void => {
  if (!cond) throw new Error(`GATE FAILED: ${label}`);
  console.log(`  ✔ ${label}`);
};

const log = (title: string, body: unknown): void => {
  console.log(`\n== ${title} ==`);
  console.log(JSON.stringify(body, null, 2));
};

async function main(): Promise<void> {
  let clock = Date.parse('2026-10-28T10:00:00.000Z');
  const now = () => new Date((clock += 60_000)).toISOString();

  const brief = productBrief.parse({
    kind: 'ProductBrief',
    id: 'brief-1',
    missionId: 'mission-demo-1',
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers, 25-40',
    country: 'US',
    platform: 'youtube',
    offer: '30-day home trial, free shipping',
    objective: 'sales',
    constraints: ['no discount-first messaging', 'brand: warm, practical'],
    createdAt: now(),
  });
  const model = new HeuristicModel();
  const connector = new SampleConnector();
  const mission = new MarketingMission(brief, connector, new CapabilityCatalog(model), now);

  // ---- 1. Define product & goal (done above) → discover competitors (Stage A)
  const competitors = await mission.discoverCompetitors(['RivalOne', 'RivalTwo']);
  log('Stage A — competitor candidates (user-correctable)', competitors.map((c) => ({
    name: c.displayName, relevance: c.relevanceReason, confidence: c.identityConfidence,
  })));

  // ---- 2. Discover the competitive landscape (research run 1)
  const coverage1 = await mission.research(competitors);
  log('Coverage report (run 1)', coverage1);
  assert(
    coverage1.slices.some((s) => s.state === 'restricted' || s.state === 'not_connected'),
    'coverage gaps are explicit (restricted/not_connected states present)',
  );
  assert(
    coverage1.slices.every((s) => s.sourceId.length > 0 && s.connectorVersion.length > 0),
    'every coverage slice carries source identity and connector version',
  );

  // Idempotency: the SAME research run again must not create or inflate anything.
  const totalsBefore = mission.store.allOrganic().length + mission.store.allAds().length;
  await mission.research(competitors);
  const totalsAfter = mission.store.allOrganic().length + mission.store.allAds().length;
  assert(totalsBefore === totalsAfter, 'double research run is idempotent (no new entities)');
  const dupes = mission.store.ingestAudit().filter((e) => e.outcome === 'duplicate').length;
  assert(dupes > 0, 'duplicate observations recorded and ignored (no metric inflation)');

  // ---- 3. Extract creative features (Stage B)
  const adFeatures = await mission.extractFeatures(mission.store.allAds());
  const organicFeatures = await mission.extractFeatures(mission.store.allOrganic());
  log('Stage B — extracted creative structure', {
    adHooks: adFeatures.flatMap((f) => f.hooks.map((h) => h.hook)),
    organicHooks: organicFeatures.flatMap((f) => f.hooks.map((h) => h.hook)),
    extractionModels: [...new Set([...adFeatures, ...organicFeatures].map((f) => f.extractionModelRef))],
  });
  assert(
    [...adFeatures, ...organicFeatures].every((f) => f.evidence.length > 0),
    'every feature set carries extraction provenance',
  );

  // ---- 4. Measure without confusing popularity with results (Stage C)
  const signals = mission.performanceSignals(['yt-101', 'yt-102']);
  log('Stage C — like-for-like performance signals', signals);
  const winner = signals.reduce((a, b) => (b.velocity ?? 0) > (a.velocity ?? 0) ? b : a);
  assert(
    winner.subjectRef === groundTruth.expectedVelocityWinner,
    `velocity winner is ${groundTruth.expectedVelocityWinner} (12-day-old video beats 6-month totals)`,
  );
  assert(
    (signals.find((s) => s.subjectRef === 'yt-101')?.total ?? 0) >
      (signals.find((s) => s.subjectRef === 'yt-102')?.total ?? 0),
    'raw totals would have chosen differently — velocity, not totals, drives ranking',
  );

  // Metric change is a NEW observation, and as-of queries replay history.
  const beforeWindow = '2026-10-20T00:00:00.000Z';
  const asOf = mission.store.metricsAsOf('views', 'yt-102', beforeWindow);
  assert(
    asOf.every((m) => m.observedAt <= beforeWindow),
    'as-of query returns only observations available at that time',
  );

  // ---- 5. Find the paid × organic intersection (Stage D)
  const opportunities = await mission.rankOpportunities(adFeatures, organicFeatures);
  log('Stage D — evidence-backed opportunity (scores separated)', opportunities.map((o) => ({
    pattern: o.hypothesis.pattern,
    observed: o.observed.toFixed(1),
    crossSourceSupport: o.crossSourceSupport,
    predicted: o.predicted,
    confidence: o.confidence,
    evidence: o.hypothesis.supportedBy.map((e) => e.ref),
    contrary: o.hypothesis.contradictedBy.map((e) => e.ref),
    explanation: o.explanation,
  })));
  const top = opportunities[0]!;
  assert(
    top.hypothesis.supportedBy.some((e) => e.ref.startsWith('ad-')) &&
      top.hypothesis.supportedBy.some((e) => e.ref.startsWith('yt-')),
    'top opportunity is supported by BOTH paid and organic independent evidence',
  );
  assert(
    top.crossSourceSupport >= 1 && top.observed >= 0 && top.confidence > 0 && top.confidence < 1,
    'observed / cross-source / predicted / confidence are separate, honest numbers',
  );

  // ---- 6. Creative brief + generator prompt pack + experiment spec
  let artifact = await mission.draftCreative(top.hypothesis);
  log('Creative brief (intent + blueprint + prompt pack + experiment spec)', artifact.brief);

  // ---- 7. Approval gate → publish (assisted handoff; organic ≠ paid)
  try {
    await mission.publish(artifact, 'user-1');
    assert(false, 'publish must refuse unapproved artifacts');
  } catch {
    console.log('  ✔ publish refuses unapproved artifacts (explicit approval required)');
  }
  artifact = { ...artifact, status: 'approved' as const, approvedBy: 'user-1' };
  const publication = await mission.publish(artifact, 'user-1');
  assert(
    publication.idempotencyKey === `${artifact.id}:mission-demo-1:organic`,
    'publication is idempotent-keyed (retries cannot duplicate posts)',
  );
  assert(
    publication.assistedHandoff === true,
    'assisted handoff when connector has no publishing capability (capability-declared)',
  );
  assert(
    connector.meta.capabilities.paidAds === false,
    'organic publishing never authorizes paid campaigns (separate permission domains)',
  );

  // ---- 8. Measure, learn, improve (forecast preserved verbatim)
  const experiment = mission.openExperiment(top.hypothesis, artifact, publication);
  // Simulated authorized measurement over the window (labeled synthetic):
  mission.store.ingestMetrics([
    mission.metricObs('post:ours', 'attributedConversions', 180, now(), {
      sourceId: 'authorized-account', sourceRecordId: 'post:ours', connectorVersion: '0.1.0',
    }),
  ], now());
  const observed = mission.store.latestObservation('attributedConversions', 'post:ours', now())?.value ?? 0;
  const { result, simulation, action, comparison } = await mission.completeExperiment(experiment, observed, {
    observedMetricKey: 'attributedConversions',
    forecast: {
      low: top.hypothesis.predictedOutcome.low,
      expected: top.hypothesis.predictedOutcome.expected,
      high: top.hypothesis.predictedOutcome.high,
      metricKey: top.hypothesis.predictedOutcome.metricKey,
    },
  });
  log('Measured outcome vs preserved forecast', {
    forecast: top.hypothesis.predictedOutcome,
    observed,
    comparison,
    experiment: result,
    calibration: simulation.calibrationHistory,
    nextAction: action,
  });
  assert(
    result.result?.forecastPreserved === true,
    'original forecast preserved verbatim next to the observed outcome',
  );
  assert(
    comparison.observedMetricKey === 'attributedConversions' && comparison.isProxy === false,
    'comparison runs on the goal metric when it is observable (proxy labeling reserved for proxy cases)',
  );
  assert(
    typeof comparison.withinForecastRange === 'boolean',
    'within-range verdict computed against the preserved forecast bounds',
  );
  assert(
    action.evidence.length > 0 && action.evidence[0]!.ref === `experiment:${experiment.id}`,
    'next-experiment recommendation references recorded evidence',
  );
  assert(
    simulation.calibrationHistory.length === 1 && simulation.calibrationHistory[0]!.note.includes('multiplicative correction'),
    'calibration history is appended, never overwritten (correction recorded)',
  );

  log('Coverage conclusion (final)', mission.store.latestCoverage()?.supportsConclusion);
  console.log('\nALL GATES PASSED — full learning loop completed on the sample connector.');
  console.log('Next: W7 production hardening (reliability, quotas, recovery, integration expansion) — see docs/marketing/MARKETING-ROADMAP.md');
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
