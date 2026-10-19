/** Independent evaluation math. Never derives relevance labels from production matching scores. */
export type RelevanceGrade = 0 | 1 | 2 | 3;
export const constraintKinds = ['region', 'city', 'graduation', 'degree', 'recruitment-type', 'deadline', 'source-freshness', 'source-origin'] as const;
export type ConstraintKind = typeof constraintKinds[number];
export interface RankingJudgment {
  jobId: string;
  /** null = unjudged, not irrelevant. */
  relevance: RelevanceGrade | null;
  eligibility: 'eligible' | 'ineligible' | 'unknown';
  /** Only positively established violations belong here; unknown facts are not violations. */
  violations?: ConstraintKind[];
  /** Per-dimension assessments. Omitted dimensions stay unknown, including for an overall eligible row. */
  constraints?: Partial<Record<ConstraintKind, 'pass' | 'violation' | 'unknown'>>;
}
export interface EvaluationFraction {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  reason?: 'unjudged-top-k' | 'unjudged-corpus' | 'no-relevant-gold' | 'no-assessed-results' | 'zero-ideal-gain';
}
export interface RankingEvaluation {
  k: number;
  /** Fixed-cutoff precision penalizes short rankings: empty ranks contribute zero, denominator stays K. */
  precision: EvaluationFraction;
  recall: EvaluationFraction;
  ndcg: EvaluationFraction;
  mrr: EvaluationFraction;
  eligibilityViolationRate: EvaluationFraction;
  constraintViolationRates: Record<ConstraintKind, EvaluationFraction>;
  constraintAssessmentCoverage: Record<ConstraintKind, { assessed: number; unknown: number; returned: number }>;
  coverage: {
    corpusSize: number; judgedCorpus: number; unjudgedCorpus: number;
    returned: number; missingSlots: number; judgedReturned: number; unjudgedReturned: number;
    assessedEligibility: number; unknownEligibility: number;
  };
  positiveThreshold: 2;
  gain: 'exponential-2^grade-1';
}

const fraction = (numerator: number | null, denominator: number | null, reason?: EvaluationFraction['reason']): EvaluationFraction => ({
  value: numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null,
  numerator, denominator, ...(reason ? { reason } : {}),
});
const discounted = (grades: number[]): number => grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);

/**
 * Full-corpus qrels are required for Recall and nDCG. Missing labels invalidate those metrics;
 * they never become synthetic negatives. Precision only requires labels in the returned top K.
 * MRR can be known if the first relevant result precedes every unjudged result.
 * Returned order is authoritative, so callers must freeze score tie-breaking before calling.
 */
export function scoreRanking(ranking: readonly string[], judgments: readonly RankingJudgment[], k = 10): RankingEvaluation {
  if (!Number.isSafeInteger(k) || k < 1 || k > 100_000) throw new Error('K must be an integer between 1 and 100000');
  const labels = new Map<string, RankingJudgment>();
  for (const judgment of judgments) {
    if (!judgment.jobId?.trim() || labels.has(judgment.jobId)) throw new Error('Judgment job IDs must be nonempty and unique');
    if (judgment.relevance !== null && ![0, 1, 2, 3].includes(judgment.relevance)) throw new Error('Relevance must be 0, 1, 2, 3, or null');
    if (!['eligible', 'ineligible', 'unknown'].includes(judgment.eligibility)) throw new Error('Unknown eligibility label');
    if (judgment.violations?.some(kind => !constraintKinds.includes(kind))) throw new Error('Unknown constraint kind');
    if (Object.entries(judgment.constraints ?? {}).some(([kind, value]) => !constraintKinds.includes(kind as ConstraintKind) || !['pass', 'violation', 'unknown'].includes(value))) throw new Error('Unknown constraint assessment');
    if (judgment.violations?.some(kind => judgment.constraints?.[kind] && judgment.constraints[kind] !== 'violation')) throw new Error('Conflicting constraint assessments');
    if ((judgment.violations?.length ?? 0) > 0 && judgment.eligibility !== 'ineligible') throw new Error('Established constraint violations require ineligible status');
    if (Object.values(judgment.constraints ?? {}).includes('violation') && judgment.eligibility !== 'ineligible') throw new Error('Established constraint violations require ineligible status');
    labels.set(judgment.jobId, judgment);
  }
  const seen = new Set<string>();
  for (const id of ranking) {
    if (!id?.trim() || seen.has(id)) throw new Error('Ranked job IDs must be nonempty and unique');
    seen.add(id);
  }
  const universe = new Set([...labels.keys(), ...ranking]);
  const judgedCorpus = [...universe].filter(id => labels.get(id)?.relevance !== null && labels.get(id)?.relevance !== undefined).length;
  const unjudgedCorpus = universe.size - judgedCorpus;
  const top = ranking.slice(0, k);
  const topLabels = top.map(id => labels.get(id));
  const unjudgedReturned = topLabels.filter(label => label?.relevance === null || label?.relevance === undefined).length;
  const relevant = [...labels.values()].filter(label => label.relevance !== null && label.relevance >= 2).length;
  const hits = topLabels.filter(label => label?.relevance !== null && label?.relevance !== undefined && label.relevance >= 2).length;
  const precision = unjudgedReturned ? fraction(null, k, 'unjudged-top-k') : fraction(hits, k);
  const recall = unjudgedCorpus ? fraction(null, null, 'unjudged-corpus')
    : relevant === 0 ? fraction(hits, 0, 'no-relevant-gold') : fraction(hits, relevant);
  const dcg = unjudgedReturned ? null : discounted(topLabels.map(label => label!.relevance!));
  const ideal = unjudgedCorpus ? null : discounted([...labels.values()].map(label => label.relevance!).sort((a, b) => b - a).slice(0, k));
  const ndcg = unjudgedCorpus ? fraction(dcg, null, 'unjudged-corpus')
    : ideal === 0 ? fraction(dcg, 0, 'zero-ideal-gain') : fraction(dcg, ideal);
  const firstHit = topLabels.findIndex(label => label?.relevance !== null && label?.relevance !== undefined && label.relevance >= 2);
  const beforeFirstHit = firstHit < 0 ? topLabels : topLabels.slice(0, firstHit);
  const uncertainFirstHit = beforeFirstHit.some(label => label?.relevance === null || label?.relevance === undefined);
  const mrr = uncertainFirstHit ? fraction(null, 1, 'unjudged-top-k') : fraction(firstHit < 0 ? 0 : 1 / (firstHit + 1), 1);
  const eligibilityLabels = topLabels.filter((label): label is RankingJudgment => !!label && label.eligibility !== 'unknown');
  const violations = eligibilityLabels.filter(label => label.eligibility === 'ineligible').length;
  const dimension = (label: RankingJudgment | undefined, kind: ConstraintKind) => label?.violations?.includes(kind) ? 'violation' : label?.constraints?.[kind] ?? 'unknown';
  const constraintAssessmentCoverage = Object.fromEntries(constraintKinds.map(kind => {
    const assessed = topLabels.filter(label => dimension(label, kind) !== 'unknown').length;
    return [kind, { assessed, unknown: top.length - assessed, returned: top.length }];
  })) as RankingEvaluation['constraintAssessmentCoverage'];
  const constraintViolationRates = Object.fromEntries(constraintKinds.map(kind => [kind, fraction(
    topLabels.filter(label => dimension(label, kind) === 'violation').length,
    constraintAssessmentCoverage[kind].assessed, constraintAssessmentCoverage[kind].assessed ? undefined : 'no-assessed-results',
  )])) as Record<ConstraintKind, EvaluationFraction>;
  return {
    k, precision, recall, ndcg, mrr,
    eligibilityViolationRate: fraction(violations, eligibilityLabels.length, eligibilityLabels.length ? undefined : 'no-assessed-results'),
    constraintViolationRates, constraintAssessmentCoverage,
    coverage: {
      corpusSize: universe.size, judgedCorpus, unjudgedCorpus,
      returned: top.length, missingSlots: Math.max(0, k - top.length), judgedReturned: top.length - unjudgedReturned,
      unjudgedReturned, assessedEligibility: eligibilityLabels.length, unknownEligibility: top.length - eligibilityLabels.length,
    },
    positiveThreshold: 2, gain: 'exponential-2^grade-1',
  };
}
