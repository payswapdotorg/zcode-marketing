/**
 * Asset validation rubric — machine implementation of the W4 deliverable
 * specified in docs/marketing/MARKETING-EVALUATION.md ("Asset validation"):
 *
 *   "Opening communicates intended benefit; product represented accurately;
 *    proof present; CTA supports goal; meets platform technical/policy
 *    requirements. Rule-based checks + model-assisted rubric; suggest
 *    corrections without silently changing approved creative."
 *
 * Design rules:
 *  - the rubric is VERSIONED; the version travels with every report so
 *    evaluation baselines stay comparable across changes;
 *  - deterministic rule checks are pure functions of the declared asset +
 *    mission context (brief, competitors) — same input, same report;
 *  - the model-assisted half (qualitative benefit/proof/CTA judgement) is
 *    routed through the capability catalog (`validateAsset` task) and its
 *    provenance recorded — heuristic output stays labeled;
 *  - the rubric NEVER rewrites or auto-fixes the creative — it reports and
 *    suggests; approved creative changes only through an explicit user action.
 *
 * Layer: app — pure domain logic, no I/O.
 */
import type { CompetitorCandidate, ProductBrief } from '../domain/records.js';

export const RUBRIC_VERSION = 'v1';

/** What the user declares about the produced asset (bring-back step, W4 gate). */
export interface AssetDeclaration {
  format: 'video' | 'image';
  /** Video only. */
  durationSec?: number;
  /** e.g. '9:16', '16:9', '1:1'. */
  aspectRatio?: string;
  /** The opening line / first on-screen text (the hook). */
  hookText: string;
  /** The demonstration / proof element the asset contains. */
  proofText: string;
  /** The closing call to action. */
  ctaText: string;
  /** Full transcript or copy, for claim/constraint scans. */
  transcriptOrCopy: string;
  /** Set when a real file was imported into the mission workspace. */
  file?: { name: string; bytes: number; path: string };
}

export interface RubricCheck {
  /** Stable rule id — evaluation sets key off these, never reorder meaning. */
  id: string;
  /** The evaluation aspect this check belongs to. */
  aspect: string;
  severity: 'pass' | 'warn' | 'fail';
  message: string;
  /** Correction suggestion — never an auto-applied edit. */
  suggestion?: string;
}

export interface RubricReport {
  rubricVersion: string;
  checks: RubricCheck[];
  /** Passed aspects / total aspects (warn counts half). */
  score: number;
  verdict: 'ready' | 'needs-review' | 'blocked';
  /** Provenance of the qualitative half: routed model or labeled heuristic. */
  assessedBy: string;
}

/** Objective-appropriate CTA verbs — "views are never sales" discipline. */
const CTA_VERBS: Record<ProductBrief['objective'], string[]> = {
  awareness: ['watch', 'see', 'follow', 'subscribe', 'learn what'],
  engagement: ['comment', 'share', 'tell us', 'tag', 'vote'],
  traffic: ['link', 'click', 'read more', 'learn more', 'visit', 'in bio'],
  leads: ['download', 'sign up', 'try', 'get your', 'start the'],
  sales: ['buy', 'order', 'shop', 'get yours', 'claim', 'checkout'],
  retention: ['again', 'renew', 'stay', 'join us', 'come back'],
};

/** Platform technical requirements (single verified platform today). */
const PLATFORM_SPEC: Record<string, { formats: Array<'video' | 'image'>; shortsMaxSec: number; longMaxSec: number; aspects: string[] }> = {
  youtube: { formats: ['video', 'image'], shortsMaxSec: 60, longMaxSec: 900, aspects: ['9:16', '16:9', '1:1'] },
};

const SUPERLATIVES = /\b(best|#1|number one|guaranteed|proven to|miracle|insane results)\b/gi;
const SUBSTANTIATORS = /\b(as rated|according to|study|survey|reviewed by|tested by|based on)\b/gi;
const DISCOUNT_WORDS = /\b(\d{1,3}\s?%|% ?off|discount|sale price|limited offer|deal ends)\b/gi;
const TRADEMARK_RISK = /\b(official|genuine|better than)\b/gi;

const countMatches = (text: string, pattern: RegExp): number =>
  (text.match(new RegExp(pattern.source, pattern.flags)) ?? []).length;

const check = (
  id: string,
  aspect: string,
  severity: RubricCheck['severity'],
  message: string,
  suggestion?: string,
): RubricCheck => ({ id, aspect, severity, message, ...(suggestion ? { suggestion } : {}) });

/**
 * Deterministic rule checks (the machine half of the rubric). Pure: same
 * declaration + mission context → same checks, in stable id order.
 */
export function runDeterministicRubric(input: {
  declaration: AssetDeclaration;
  brief: ProductBrief;
  competitors: CompetitorCandidate[];
}): RubricCheck[] {
  const { declaration, brief, competitors } = input;
  const checks: RubricCheck[] = [];
  const copy = `${declaration.hookText}\n${declaration.transcriptOrCopy}`;

  // Aspect: opening communicates intended benefit.
  const hookWords = declaration.hookText.trim().split(/\s+/).filter(Boolean);
  if (hookWords.length === 0) {
    checks.push(check('opening-benefit', 'opening-benefit', 'fail', 'no opening/hook declared', 'Write the exact first line or on-screen text of the asset.'));
  } else if (hookWords.length > 20) {
    checks.push(check('opening-benefit', 'opening-benefit', 'warn', `opening is ${hookWords.length} words — too long to land the benefit in the first 3 seconds`, 'Cut the opening to a single benefit-led line.'));
  } else {
    checks.push(check('opening-benefit', 'opening-benefit', 'pass', `opening present (${hookWords.length} words)`));
  }

  // Aspect: product represented accurately (declared, machine-checkable part:
  // the product/offer words appear somewhere in the asset copy).
  const productWords = brief.product.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const offerWords = brief.offer.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const haystack = copy.toLowerCase();
  const missingProduct = productWords.filter((w) => !haystack.includes(w));
  const missingOffer = offerWords.filter((w) => !haystack.includes(w));
  if (missingProduct.length > 0) {
    checks.push(check('product-accuracy', 'product-accuracy', 'warn', `asset copy never mentions: ${missingProduct.slice(0, 4).join(', ')}`, 'The product must be recognizable in the asset; mention the product name.'));
  } else if (missingOffer.length > 0 && offerWords.length > 0) {
    checks.push(check('product-accuracy', 'product-accuracy', 'pass', `product mentioned; offer words partially present (${missingOffer.length} absent) — confirm the offer reads accurately`));
  } else {
    checks.push(check('product-accuracy', 'product-accuracy', 'pass', 'product and offer language present in the copy'));
  }

  // Aspect: proof present.
  if (declaration.proofText.trim().length === 0) {
    checks.push(check('proof-present', 'proof-present', 'fail', 'no demonstration/proof element declared', 'Add the moment that shows the product working (demo, before/after, testimonial).'));
  } else {
    checks.push(check('proof-present', 'proof-present', 'pass', 'proof element declared'));
  }

  // Aspect: CTA supports the goal.
  const cta = declaration.ctaText.trim().toLowerCase();
  const verbs = CTA_VERBS[brief.objective];
  if (cta.length === 0) {
    checks.push(check('cta-objective', 'cta-objective', 'fail', 'no CTA declared', 'End with one action the viewer can take.'));
  } else if (!verbs.some((verb) => cta.includes(verb))) {
    checks.push(check('cta-objective', 'cta-objective', 'warn', `CTA does not match the '${brief.objective}' objective (expected one of: ${verbs.join(', ')})`, `Align the CTA with the objective — e.g. "${verbs[0]} …".`));
  } else {
    checks.push(check('cta-objective', 'cta-objective', 'pass', `CTA matches the '${brief.objective}' objective`));
  }

  // Aspect: platform technical/policy requirements.
  const spec = PLATFORM_SPEC[brief.platform];
  if (!spec) {
    checks.push(check('platform-tech', 'platform-tech', 'warn', `no machine-checkable tech spec recorded for platform '${brief.platform}' — verify duration/aspect manually`));
  } else {
    const tech: string[] = [];
    let severity: RubricCheck['severity'] = 'pass';
    if (!spec.formats.includes(declaration.format)) {
      tech.push(`format '${declaration.format}' not standard for ${brief.platform}`);
      severity = 'fail';
    }
    if (declaration.aspectRatio && !spec.aspects.includes(declaration.aspectRatio)) {
      tech.push(`aspect '${declaration.aspectRatio}' outside ${spec.aspects.join('/')}`);
      severity = severity === 'fail' ? 'fail' : 'warn';
    }
    if (declaration.format === 'video') {
      if (declaration.durationSec === undefined) {
        tech.push('duration not declared');
        severity = severity === 'fail' ? 'fail' : 'warn';
      } else {
        const vertical = declaration.aspectRatio === '9:16';
        const max = vertical ? spec.shortsMaxSec : spec.longMaxSec;
        if (declaration.durationSec > max) {
          tech.push(`${declaration.durationSec}s exceeds the ${vertical ? 'shorts' : 'long-form'} limit of ${max}s`);
          severity = 'fail';
        }
      }
    }
    checks.push(check('platform-tech', 'platform-tech', severity, tech.length === 0 ? `format/aspect/duration fit ${brief.platform}` : tech.join('; '), tech.length === 0 ? undefined : 'Adjust the export settings to the platform requirements.'));
  }

  // Aspect: claims honesty (anti-overfitting rule from MARKETING-EVALUATION.md).
  const superlatives = countMatches(copy, SUPERLATIVES);
  const substantiators = countMatches(copy, SUBSTANTIATORS);
  if (superlatives > substantiators) {
    checks.push(check('claims-honesty', 'claims-honesty', 'warn', `${superlatives} superlative claim(s) with ${substantiators} substantiation marker(s)`, 'Add the source of the claim or soften it; the evaluation set fails unsubstantiated superlatives.'));
  } else {
    checks.push(check('claims-honesty', 'claims-honesty', 'pass', `${superlatives} superlative(s), ${substantiators} substantiation marker(s)`));
  }

  // Aspect: brand constraints (machine-checkable subset).
  for (const constraint of brief.constraints ?? []) {
    const lowered = constraint.toLowerCase();
    if (lowered.includes('discount') || lowered.includes('sale')) {
      const hits = countMatches(copy, DISCOUNT_WORDS);
      checks.push(
        hits > 0
          ? check(`brand-constraint:${constraint.slice(0, 40)}`, 'brand-constraints', 'fail', `copy contains ${hits} discount-style phrase(s) while the brief constrains: "${constraint}"`, 'Remove the discount language — the brief constrains it.')
          : check(`brand-constraint:${constraint.slice(0, 40)}`, 'brand-constraints', 'pass', `no discount-style language found (constraint: "${constraint}")`),
      );
    } else {
      checks.push(check(`brand-constraint:${constraint.slice(0, 40)}`, 'brand-constraints', 'warn', `manual review required — constraint "${constraint}" is not machine-checkable`));
    }
  }
  // Competitor trademark risk: names the mission tracks must not appear.
  const nameHits = competitors
    .map((c) => c.displayName)
    .filter((name) => name.length > 2 && copy.toLowerCase().includes(name.toLowerCase()));
  if (nameHits.length > 0) {
    checks.push(check('competitor-trademarks', 'brand-constraints', 'fail', `copy mentions tracked competitor name(s): ${nameHits.join(', ')}`, 'Remove or mask competitor trademarks; the prompt packs also negative-constrain them.'));
  } else {
    checks.push(check('competitor-trademarks', 'brand-constraints', 'pass', 'no tracked competitor names in the copy'));
  }
  if (countMatches(copy, TRADEMARK_RISK) > 0) {
    checks.push(check('trademark-phrasing', 'brand-constraints', 'warn', 'phrasing like "official"/"better than" raises trademark risk — confirm it refers to your own product'));
  }

  // Aspect: the asset actually exists in the mission (file bring-back).
  if (declaration.file) {
    checks.push(
      declaration.file.bytes > 0
        ? check('file-present', 'file-present', 'pass', `imported file recorded: ${declaration.file.name} (${declaration.file.bytes} bytes)`)
        : check('file-present', 'file-present', 'fail', 'imported file is empty'),
    );
  } else {
    checks.push(check('file-present', 'file-present', 'warn', 'no file imported — declaration only', 'Import the produced file so the mission holds the actual asset.'));
  }

  return checks;
}

/** Score + verdict from the merged check list (deterministic + qualitative). */
export function scoreRubric(checks: RubricCheck[]): { score: number; verdict: RubricReport['verdict'] } {
  if (checks.length === 0) return { score: 0, verdict: 'blocked' };
  let points = 0;
  let possible = 0;
  for (const item of checks) {
    possible += 1;
    if (item.severity === 'pass') points += 1;
    else if (item.severity === 'warn') points += 0.5;
  }
  const score = Math.round((points / possible) * 100) / 100;
  const verdict: RubricReport['verdict'] = checks.some((c) => c.severity === 'fail')
    ? 'blocked'
    : checks.some((c) => c.severity === 'warn')
      ? 'needs-review'
      : 'ready';
  return { score, verdict };
}

/** Merge deterministic checks with the routed qualitative assessment. */
export function buildRubricReport(input: {
  declaration: AssetDeclaration;
  brief: ProductBrief;
  competitors: CompetitorCandidate[];
  qualitative: { issues: Array<{ aspect: string; message: string; suggestion?: string }>; executedModelRef: string };
}): RubricReport {
  const deterministic = runDeterministicRubric({
    declaration: input.declaration,
    brief: input.brief,
    competitors: input.competitors,
  });
  const qualitative = input.qualitative.issues.map((issue) =>
    check(`qualitative:${issue.aspect}`, issue.aspect, 'warn', issue.message, issue.suggestion),
  );
  const checks = [...deterministic, ...qualitative];
  const { score, verdict } = scoreRubric(checks);
  return { rubricVersion: RUBRIC_VERSION, checks, score, verdict, assessedBy: input.qualitative.executedModelRef };
}
