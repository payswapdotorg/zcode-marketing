# PLATFORM-CONNECTOR-CONTRACT

> Standard interfaces, typed errors, capability declarations, and conformance requirements for every marketing data connector. Owned by Worker A. Implemented as machine-checked types in `packages/marketing/src/app/ports.ts` (zod). Last updated: 2026-10-28 (W1 contract freeze candidate).

## Scope

A **connector** is any adapter that moves data or actions between the marketing domain and an external platform (ad libraries, social platforms, creative tools, publishing targets). The contract is **connector-neutral from day one** even though the first release supports a deliberately small number of fully tested integrations. Creative-production tools (Higgsfield etc.) use a **separate adapter port** — they are never part of the research workflow's connector calls.

## Capability declaration (mandatory, per connector instance)

```ts
type ConnectorCapabilities = {
  /** operation classes this connector may perform — access to one NEVER implies another */
  research: boolean;        // discover ads / content / advertiser metadata
  analytics: boolean;       // authorized account metrics
  publishing: boolean;      // create posts on a connected account
  scheduling: boolean;      // schedule posts
  paidAds: boolean;         // paid campaign execution — separate permission domain
};
```

Alongside capabilities, each connector declares: supported platforms/regions, supported operations with request/response schemas, rate limits and quotas, expected freshness, retention restrictions, auth model (`apiKey` | `oauthUser` | `public` | `import`), and the access-verification reference from `MARKETING-DATA-SOURCES.md` (only `verified` rows may become foundational).

## The port (shape every connector implements)

```ts
interface MarketingConnector {
  readonly meta: ConnectorMeta;             // id, version, platform, capabilities, auth, coverage notes
  readonly coverage: CoverageLedgerSource;  // what this source can and cannot cover, honestly
  research(request: ResearchRequest): Promise<ResearchPage>;
  analytics?(request: AnalyticsRequest): Promise<AnalyticsPage>;   // present iff capabilities.analytics
  publish?(request: PublishRequest): Promise<PublicationRecord>;   // present iff capabilities.publishing
  healthCheck(): Promise<ConnectorHealth>;
}
```

Requests are declarative; connectors translate them into platform calls through the runtime's I/O convergence layer. All responses are pages with stable source record identities for idempotent ingestion.

## Typed errors (no stringly-typed failures)

```ts
type ConnectorError =
  | { kind: 'auth_required'; scope: string; reauthHint?: string }
  | { kind: 'permission_denied'; operation: string; policy: string }
  | { kind: 'rate_limited'; retryAfterMs?: number; quotaScope?: string }
  | { kind: 'coverage_gap'; coverageState: CoverageState; detail: string }  // source legitimately lacks this data
  | { kind: 'transient_network'; retryable: boolean; attempt?: number }
  | { kind: 'schema_drift'; expectedVersion: string; gotVersion: string }
  | { kind: 'policy_violation'; rule: string };  // request would breach source policy — refuse, never retry
```

Rule: `coverage_gap` is a **normal result**, not a failure — it feeds the CoverageReport. `policy_violation` aborts without retry. Retries are bounded by the runtime's existing retry/timeout/cancellation semantics; connectors must be idempotent under retry so **retries can never silently create duplicate posts**.

## Provenance requirement

Every page returned carries, per record: source id, source record identity, retrieval method (api | transparency | authorizedImport | archive), retrieval time, applicable metric-definition versions, and region. The temporal store refuses records without provenance (see MARKETING-DATA-MODEL.md).

## Conformance requirements (checked before a connector ships)

1. **Fixture tests**: recorded request/response fixtures for every operation; no live calls in unit tests.
2. **Idempotency test**: ingest the same fixture twice → same entities, no metric inflation (temporal store double-ingest test).
3. **Coverage honesty test**: a deliberately-missing slice produces `coverage_gap`, not invented data; the CoverageReport reflects it.
4. **Auth hygiene**: credentials live only in the runtime's credential store; they never appear in logs, prompts, tool outputs, or persisted artifacts (grep-enforced).
5. **Rate/limit behavior**: rate-limited responses surface `rate_limited` with backoff hints; no silent spin.
6. **Policy gate**: no scraping of authenticated pages as a data strategy; browser-based collection only via permitted public transparency routes and only through the runtime's browser/web-search extension points.

## Sample connector (reference implementation)

`packages/marketing/src/adapters/sampleConnector.ts` ships as the conformance reference: fixture-driven, zero network, exercises every rule above, and powers the end-to-end loop demo (`packages/marketing/src/demo`) without external dependencies. Real connectors (YouTube public data first, per MARKETING-DATA-SOURCES.md) must reach parity with it before becoming foundational.
