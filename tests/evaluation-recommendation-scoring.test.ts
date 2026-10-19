import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreRecommendations } from '../packages/evaluation/src/recommendation-scoring.js';
import { scoreRanking, type RankingJudgment } from '../packages/evaluation/src/ranking-scoring.js';

const pool: RankingJudgment[] = [
  { jobId: 'direct', relevance: 3, eligibility: 'eligible' },
  { jobId: 'related', relevance: 2, eligibility: 'eligible' },
  { jobId: 'wrong-region', relevance: 3, eligibility: 'ineligible', constraints: { region: 'violation' } },
  { jobId: 'weak-unknown-eligibility', relevance: 1, eligibility: 'unknown' },
  { jobId: 'related-unknown-eligibility', relevance: 3, eligibility: 'unknown' },
];

test('shortlist suitability counts and fixed-K bounds retain independently assessed denominators', () => {
  const ranking = ['direct', 'wrong-region', 'related-unknown-eligibility', 'weak-unknown-eligibility'];
  const result = scoreRecommendations(ranking, pool, 5);
  assert.equal(result.confirmedSuitableCount, 1);
  assert.equal(result.confirmedUnsuitableCount, 2);
  assert.equal(result.suitabilityUnknownCount, 1);
  assert.equal(result.emptySlots, 1);
  assert.deepEqual([result.confirmedSuitableLowerAtK.numerator, result.confirmedSuitableLowerAtK.denominator, result.confirmedSuitableLowerAtK.value], [1, 5, .2]);
  assert.deepEqual([result.possibleSuitableUpperAtK.numerator, result.possibleSuitableUpperAtK.denominator, result.possibleSuitableUpperAtK.value], [2, 5, .4]);
  assert.deepEqual([result.knownSuitableRecall.numerator, result.knownSuitableRecall.denominator, result.knownSuitableRecall.value], [1, 2, .5]);
  assert.deepEqual([result.eligibilityViolationRate.numerator, result.eligibilityViolationRate.denominator, result.eligibilityViolationRate.value], [1, 2, .5]);
  assert.equal(result.eligibilityAssessedCount, 2); assert.equal(result.eligibilityUnknownCount, 2);
  assert.equal(result.eligibilityAssessmentCoverage.value, .5);
  assert.equal(result.countDenominators.suitabilityUnknownCount, 4);
  assert.equal(result.countDenominators.emptySlots, 5);
  assert.deepEqual(result.semanticNdcg, scoreRanking(ranking, pool, 5).ndcg);
});

test('one known failure determines unsuitable even if the other judgment dimension is unknown', () => {
  const judgments: RankingJudgment[] = [
    { jobId: 'no-semantic-but-ineligible', relevance: null, eligibility: 'ineligible' },
    { jobId: 'low-semantic-unknown-eligibility', relevance: 0, eligibility: 'unknown' },
    { jobId: 'unknown-semantic-known-eligible', relevance: null, eligibility: 'eligible' },
    { jobId: 'related-unknown-eligibility', relevance: 2, eligibility: 'unknown' },
    { jobId: 'related-known-eligible', relevance: 2, eligibility: 'eligible' },
  ];
  const result = scoreRecommendations(judgments.map(row => row.jobId), judgments, 5);
  assert.equal(result.confirmedSuitableCount, 1); assert.equal(result.confirmedUnsuitableCount, 2); assert.equal(result.suitabilityUnknownCount, 2);
  assert.equal(result.confirmedSuitableLowerAtK.value, .2); assert.equal(result.possibleSuitableUpperAtK.value, .6);
  assert.equal(result.suitabilityUnknownGoldCount, 2);
  assert.equal(result.semanticNdcg.value, null, 'missing semantic gold is not silently converted to zero');
});

test('valid short and empty outputs preserve empty slots without rewarding abstention', () => {
  const empty = scoreRecommendations([], pool, 5);
  assert.equal(empty.returnedCount, 0); assert.equal(empty.emptySlots, 5);
  assert.equal(empty.confirmedSuitableLowerAtK.value, 0); assert.equal(empty.possibleSuitableUpperAtK.value, 0);
  assert.equal(empty.knownSuitableRecall.value, 0);
  assert.equal(empty.eligibilityViolationRate.value, null); assert.equal(empty.eligibilityViolationRate.denominator, 0);
  assert.equal(empty.eligibilityAssessmentCoverage.value, null);
  const short = scoreRecommendations(['related-unknown-eligibility'], pool, 5);
  assert.equal(short.emptySlots, 4); assert.equal(short.confirmedSuitableLowerAtK.value, 0);
  assert.equal(short.possibleSuitableUpperAtK.value, .2, 'four omitted slots are not four possible suitable recommendations');
  assert.equal(short.eligibilityAssessedCount, 0); assert.equal(short.eligibilityUnknownCount, 1);
});

test('known-subset recall has a zero-denominator null and never presents unknown positives as known negatives', () => {
  const judgments: RankingJudgment[] = [
    { jobId: 'uncertain', relevance: null, eligibility: 'eligible' },
    { jobId: 'wrong', relevance: 3, eligibility: 'ineligible' },
  ];
  const result = scoreRecommendations(['uncertain'], judgments, 5);
  assert.equal(result.knownSuitableGoldCount, 0);
  assert.equal(result.knownSuitableRecall.value, null); assert.equal(result.knownSuitableRecall.denominator, 0);
  assert.equal(result.knownSuitableRecall.reason, 'no-known-suitable-gold');
  assert.equal(result.confirmedSuitableLowerAtK.value, 0); assert.equal(result.possibleSuitableUpperAtK.value, .2);
  const noCandidates = scoreRecommendations([], [], 5);
  assert.equal(noCandidates.knownSuitableRecall.value, null);
  assert.equal(noCandidates.poolSize, 0);
});

test('high semantic nDCG does not become a false qualification or suitability score', () => {
  const judgments: RankingJudgment[] = [{ jobId: 'overseas-direct-match', relevance: 3, eligibility: 'ineligible', violations: ['region'] }];
  const result = scoreRecommendations(['overseas-direct-match'], judgments, 1);
  assert.equal(result.semanticNdcg.value, 1);
  assert.equal(result.confirmedSuitableLowerAtK.value, 0);
  assert.equal(result.possibleSuitableUpperAtK.value, 0);
  assert.equal(result.eligibilityViolationRate.value, 1);
  assert.match(result.semanticNdcgDefinition, /not a suitability score/u);
});

test('unknown gold outside the shortlist cannot silently increase the known-suitable recall denominator', () => {
  const extended: RankingJudgment[] = [...pool, { jobId: 'unjudged', relevance: null, eligibility: 'unknown' }];
  const result = scoreRecommendations(['direct'], extended, 5);
  assert.equal(result.knownSuitableRecall.denominator, 2);
  assert.equal(result.knownSuitableRecall.value, .5);
  assert.equal(result.semanticNdcg.value, null);
  assert.equal(result.suitabilityUnknownGoldCount, 2);
});

test('shortlists reject unknown/duplicate IDs, over-budget results and malformed gold instead of repairing them', () => {
  assert.throws(() => scoreRecommendations(['not-in-pool'], pool, 5), /unknown candidate/u);
  assert.throws(() => scoreRecommendations(['direct', 'direct'], pool, 5), /unique/u);
  assert.throws(() => scoreRecommendations(['direct', 'related'], pool, 1), /fixed K/u);
  assert.throws(() => scoreRecommendations([], [...pool, pool[0]!]), /unique/u);
  assert.throws(() => scoreRecommendations([], [{ jobId: 'bad', relevance: 9, eligibility: 'eligible' } as unknown as RankingJudgment]), /Relevance/u);
  for (const k of [0, -1, 1.1, NaN, Infinity]) assert.throws(() => scoreRecommendations([], pool, k), /K must/u);
});

test('shortlist scoring leaves the independent pool and supplied order unchanged', () => {
  const original = JSON.stringify(pool), ranking = ['related', 'direct']; const copy = [...ranking];
  scoreRecommendations(ranking, pool, 5);
  assert.equal(JSON.stringify(pool), original); assert.deepEqual(ranking, copy);
});
