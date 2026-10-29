/**
 * W4 rubric tests — the machine-implemented asset validation rules.
 *
 * Deterministic gates (same declaration + mission context → same report):
 *  - a clean declaration passes every machine aspect;
 *  - each rule fires exactly when it should (fail/warn cases);
 *  - score/verdict aggregation (fail → blocked, warn → needs-review);
 *  - the versioned report carries the qualitative provenance verbatim.
 */
import { describe, expect, it } from 'vitest';
import { buildRubricReport, runDeterministicRubric, scoreRubric, RUBRIC_VERSION } from '../src/app/rubric.js';
import { productBrief } from '../src/domain/records.js';
import type { CompetitorCandidate, ProductBrief } from '../src/domain/records.js';

const brief: ProductBrief = productBrief.parse({
  kind: 'ProductBrief',
  id: 'brief-test',
  missionId: 'mission-test',
  product: 'portable espresso maker',
  audience: 'commuting coffee drinkers',
  country: 'US',
  platform: 'youtube',
  offer: '30-day home trial free shipping',
  objective: 'sales',
  constraints: ['no discount-first messaging'],
  createdAt: '2026-10-29T00:00:00Z',
});

const competitors: CompetitorCandidate[] = [
  {
    kind: 'CompetitorCandidate',
    id: 'competitor-1',
    missionId: 'mission-test',
    displayName: 'AeroPress',
    aliases: [],
    identityConfidence: 0.9,
    relevanceReason: 'test',
    evidence: [],
    userConfirmed: true,
  },
];

const clean = {
  format: 'video' as const,
  durationSec: 28,
  aspectRatio: '9:16',
  hookText: 'Cafe-grade espresso on your commute — no machine',
  proofText: 'unedited before/after of the extraction',
  ctaText: 'Get yours with the 30-day trial',
  transcriptOrCopy:
    'Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot, tested by our lab survey. Get yours with the 30-day trial.',
  file: { name: 'ad-v1.mp4', bytes: 2048, path: '.zcode/marketing/missions/m/artifacts/ad-v1.mp4' },
};

const byId = (checks: ReturnType<typeof runDeterministicRubric>) =>
  Object.fromEntries(checks.map((c) => [c.id, c]));

describe('asset validation rubric (W4)', () => {
  it('passes every machine aspect on a clean declaration', () => {
    const checks = runDeterministicRubric({ declaration: clean, brief, competitors });
    const map = byId(checks);
    expect(map['opening-benefit'].severity).toBe('pass');
    expect(map['proof-present'].severity).toBe('pass');
    expect(map['cta-objective'].severity).toBe('pass');
    expect(map['platform-tech'].severity).toBe('pass');
    expect(map['claims-honesty'].severity).toBe('pass');
    expect(map['competitor-trademarks'].severity).toBe('pass');
    expect(map['file-present'].severity).toBe('pass');
    // The brief constrains discount-first messaging; machine check runs it.
    expect(map['brand-constraint:no discount-first messaging'].severity).toBe('pass');
  });

  it('fails the missing opening, proof, and CTA', () => {
    const checks = runDeterministicRubric({
      declaration: { ...clean, hookText: '', proofText: '', ctaText: '' },
      brief,
      competitors,
    });
    const map = byId(checks);
    expect(map['opening-benefit'].severity).toBe('fail');
    expect(map['proof-present'].severity).toBe('fail');
    expect(map['cta-objective'].severity).toBe('fail');
  });

  it('warns when the CTA does not match the objective', () => {
    const checks = runDeterministicRubric({
      declaration: { ...clean, ctaText: 'Subscribe for more videos' },
      brief,
      competitors,
    });
    const map = byId(checks);
    expect(map['cta-objective'].severity).toBe('warn');
    expect(map['cta-objective'].suggestion).toBeTruthy();
  });

  it('fails shorts-format duration overflow and warns on aspect mismatch', () => {
    const checks = runDeterministicRubric({
      declaration: { ...clean, durationSec: 90 },
      brief,
      competitors,
    });
    expect(byId(checks)['platform-tech'].severity).toBe('fail');
    const aspect = runDeterministicRubric({
      declaration: { ...clean, aspectRatio: '4:3' },
      brief,
      competitors,
    });
    expect(byId(aspect)['platform-tech'].severity).toBe('warn');
  });

  it('flags superlatives without substantiation and competitor trademarks', () => {
    const checks = runDeterministicRubric({
      declaration: {
        ...clean,
        transcriptOrCopy: `${clean.transcriptOrCopy} The best espresso, guaranteed, number one. Better than AeroPress.`,
      },
      brief,
      competitors,
    });
    const map = byId(checks);
    expect(map['claims-honesty'].severity).toBe('warn');
    expect(map['competitor-trademarks'].severity).toBe('fail');
    expect(map['competitor-trademarks'].message).toContain('AeroPress');
  });

  it('fails discount language against a discount-constraining brief', () => {
    const checks = runDeterministicRubric({
      declaration: { ...clean, transcriptOrCopy: `${clean.transcriptOrCopy} 50% off, limited offer!` },
      brief,
      competitors,
    });
    expect(byId(checks)['brand-constraint:no discount-first messaging'].severity).toBe('fail');
  });

  it('warns when no file was imported (declaration only)', () => {
    const { file, ...declarationOnly } = clean;
    void file;
    const checks = runDeterministicRubric({ declaration: declarationOnly, brief, competitors });
    expect(byId(checks)['file-present'].severity).toBe('warn');
  });

  it('aggregates score and verdict deterministically', () => {
    expect(scoreRubric(runDeterministicRubric({ declaration: clean, brief, competitors }))).toEqual({
      score: 1,
      verdict: 'ready',
    });
    const blocked = scoreRubric(
      runDeterministicRubric({ declaration: { ...clean, hookText: '', ctaText: 'subscribe' }, brief, competitors }),
    );
    expect(blocked.verdict).toBe('blocked');
    expect(blocked.score).toBeLessThan(1);
    const review = scoreRubric(
      runDeterministicRubric({ declaration: { ...clean, ctaText: 'subscribe' }, brief, competitors }),
    );
    expect(review.verdict).toBe('needs-review');
  });

  it('builds the versioned report with qualitative provenance', () => {
    const report = buildRubricReport({
      declaration: clean,
      brief,
      competitors,
      qualitative: {
        issues: [
          {
            aspect: 'opening-benefit',
            message: 'benefit lands at second 4 — tighten the first line',
            suggestion: 'Move the claim to the first frame',
          },
        ],
        executedModelRef: 'zcode:routed:glm-4-plus',
      },
    });
    expect(report.rubricVersion).toBe(RUBRIC_VERSION);
    expect(report.assessedBy).toBe('zcode:routed:glm-4-plus');
    expect(report.checks.some((c) => c.id === 'qualitative:opening-benefit')).toBe(true);
    expect(report.verdict).toBe('needs-review');
    // Deterministic half stays stable regardless of the qualitative half.
    expect(report.checks.filter((c) => !c.id.startsWith('qualitative:')).length).toBe(
      runDeterministicRubric({ declaration: clean, brief, competitors }).length,
    );
  });
});
