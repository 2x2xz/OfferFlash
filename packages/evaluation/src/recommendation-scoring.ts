import { scoreRanking, type EvaluationFraction, type RankingJudgment } from './ranking-scoring.js';

/** Separate shortlist protocol; does not change the original full-ranking labels or metrics. */
export const RECOMMENDATION_SCORING_VERSION = 'offerflash-shortlist-v1';
export interface RecommendationFraction {
  value: number | null; numerator: number; denominator: number;
  definition: string;
  reason?: 'no-known-suitable-gold' | 'no-assessed-eligibility' | 'no-returned-results';
}
export interface RecommendationEvaluation {
  version: typeof RECOMMENDATION_SCORING_VERSION;
  k: number; poolSize: number; returnedCount: number;
  confirmedSuitableCount: number; confirmedUnsuitableCount: number; suitabilityUnknownCount: number; emptySlots: number;
  knownSuitableGoldCount: number; suitabilityUnknownGoldCount: number;
  eligibilityAssessedCount: number; eligibilityUnknownCount: number; eligibilityViolationCount: number;
  /** These counts describe returned results, except emptySlots (K) and gold counts (full pool). */
  countDenominators: {
    confirmedSuitableCount: number; confirmedUnsuitableCount: number; suitabilityUnknownCount: number;
    emptySlots: number; knownSuitableGoldCount: number; suitabilityUnknownGoldCount: number;
    eligibilityAssessedCount: number; eligibilityUnknownCount: number; eligibilityViolationCount: number;
  };
  confirmedSuitableLowerAtK: RecommendationFraction;
  possibleSuitableUpperAtK: RecommendationFraction;
  /** Recall only over the independently known suitable subset, never an estimate of all true positives. */
  knownSuitableRecall: RecommendationFraction;
  eligibilityViolationRate: RecommendationFraction;
  eligibilityAssessmentCoverage: RecommendationFraction;
  /** Raw semantic ranking diagnostic; qualification is deliberately not folded into this score. */
  semanticNdcg: EvaluationFraction;
  semanticNdcgDefinition: string;
  interpretation: string;
}
type Suitability = 'suitable' | 'unsuitable' | 'unknown';
function suitability(judgment: RankingJudgment): Suitability {
  // One proven failure is sufficient even when the other dimension is unknown.
  if (judgment.eligibility === 'ineligible' || (judgment.relevance !== null && judgment.relevance < 2)) return 'unsuitable';
  if (judgment.eligibility === 'eligible' && judgment.relevance !== null && judgment.relevance >= 2) return 'suitable';
  return 'unknown';
}
const fraction = (numerator: number, denominator: number, definition: string, reason?: RecommendationFraction['reason']): RecommendationFraction => ({
  value: denominator > 0 ? numerator / denominator : null, numerator, denominator, definition,
  ...(denominator === 0 && reason ? { reason } : {}),
});

/**
 * Score at most K recommendations against a fixed, explicitly labeled candidate pool.
 * A short or empty list is valid; omitted slots cannot contribute to either suitability bound.
 * Null semantic relevance and unknown eligibility are not converted into negative gold.
 * All counts come from supplied independent qrels, never the recommender's own confidence.
 */
export function scoreRecommendations(ranking: readonly string[], judgments: readonly RankingJudgment[], k = 5): RecommendationEvaluation {
  if (!Number.isSafeInteger(k) || k < 1 || k > 100_000) throw new Error('K must be an integer between 1 and 100000');
  if (ranking.length > k) throw new Error('Recommendation list exceeds the fixed K budget');
  const pool = new Map(judgments.map(judgment => [judgment.jobId, judgment]));
  if (ranking.some(id => !pool.has(id))) throw new Error('Recommendation contains an unknown candidate ID');
  // Reuse existing qrel, rank-uniqueness, grade and constraint validation unchanged.
  const semantic = scoreRanking(ranking, judgments, k);
  const selected = ranking.map(id => pool.get(id)!);
  const selectedSuitability = selected.map(suitability);
  const confirmedSuitableCount = selectedSuitability.filter(value => value === 'suitable').length;
  const confirmedUnsuitableCount = selectedSuitability.filter(value => value === 'unsuitable').length;
  const suitabilityUnknownCount = selectedSuitability.filter(value => value === 'unknown').length;
  const knownSuitableGoldCount = judgments.filter(judgment => suitability(judgment) === 'suitable').length;
  const suitabilityUnknownGoldCount = judgments.filter(judgment => suitability(judgment) === 'unknown').length;
  const eligibilityAssessedCount = selected.filter(judgment => judgment.eligibility !== 'unknown').length;
  const eligibilityUnknownCount = selected.length - eligibilityAssessedCount;
  const eligibilityViolationCount = selected.filter(judgment => judgment.eligibility === 'ineligible').length;
  return {
    version: RECOMMENDATION_SCORING_VERSION, k, poolSize: judgments.length, returnedCount: selected.length,
    confirmedSuitableCount, confirmedUnsuitableCount, suitabilityUnknownCount, emptySlots: k - selected.length,
    knownSuitableGoldCount, suitabilityUnknownGoldCount, eligibilityAssessedCount, eligibilityUnknownCount, eligibilityViolationCount,
    countDenominators: {
      confirmedSuitableCount: selected.length, confirmedUnsuitableCount: selected.length, suitabilityUnknownCount: selected.length,
      emptySlots: k, knownSuitableGoldCount: judgments.length, suitabilityUnknownGoldCount: judgments.length,
      eligibilityAssessedCount: selected.length, eligibilityUnknownCount: selected.length, eligibilityViolationCount: eligibilityAssessedCount,
    },
    confirmedSuitableLowerAtK: fraction(confirmedSuitableCount, k,
      'Confirmed suitable returned recommendations / fixed K slots; suitable requires relevance >= 2 AND known eligible.'),
    possibleSuitableUpperAtK: fraction(confirmedSuitableCount + suitabilityUnknownCount, k,
      '(Confirmed suitable + suitability-unknown returned recommendations) / fixed K; empty slots never count as possibly suitable.'),
    knownSuitableRecall: fraction(confirmedSuitableCount, knownSuitableGoldCount,
      'Returned confirmed suitable / full-pool known suitable (relevance >= 2 AND eligible); conditional known-subset recall, not full true recall.', 'no-known-suitable-gold'),
    eligibilityViolationRate: fraction(eligibilityViolationCount, eligibilityAssessedCount,
      'Returned ineligible / returned eligibility-assessed; unknown eligibility excluded from this denominator and counted separately.', 'no-assessed-eligibility'),
    eligibilityAssessmentCoverage: fraction(eligibilityAssessedCount, selected.length,
      'Returned eligibility-assessed / actual returned recommendations; empty results have no assessed-result coverage.', 'no-returned-results'),
    semanticNdcg: semantic.ndcg,
    semanticNdcgDefinition: 'scoreRanking(ranking, fullPoolJudgments, K).ndcg: exponential semantic gain only; includes semantic matches that may be ineligible and is not a suitability score.',
    interpretation: 'Unknown suitability is represented only by lower/upper bounds. A valid empty shortlist is an abstention, not a positive suitability result. Labels and CV/job snapshots must be frozen separately.',
  };
}
