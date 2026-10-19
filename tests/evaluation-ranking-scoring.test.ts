import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreRanking, type RankingJudgment } from '../packages/evaluation/src/ranking-scoring.js';

const qrels: RankingJudgment[] = [
  { jobId: 'strong', relevance: 3, eligibility: 'eligible', constraints: { region: 'pass', graduation: 'pass', deadline: 'pass' } },
  { jobId: 'good', relevance: 2, eligibility: 'eligible', constraints: { region: 'pass', graduation: 'pass' } },
  { jobId: 'weak', relevance: 1, eligibility: 'unknown' },
  { jobId: 'wrong', relevance: 0, eligibility: 'ineligible', violations: ['region', 'graduation'] },
];

test('ranking metrics use independent grades, exponential gain, and explicit denominators', () => {
  const result = scoreRanking(['good', 'wrong', 'strong', 'weak'], qrels, 3);
  assert.equal(result.precision.value, 2 / 3);
  assert.equal(result.recall.value, 1);
  assert.equal(result.mrr.value, 1);
  assert.equal(result.ndcg.numerator, 3 + 7 / 2);
  assert.equal(result.ndcg.denominator, 7 + 3 / Math.log2(3) + 1 / 2);
  assert.equal(result.eligibilityViolationRate.value, 1 / 3);
  assert.equal(result.constraintViolationRates.region.value, 1 / 3);
  assert.equal(result.constraintViolationRates.graduation.value, 1 / 3);
  assert.equal(result.constraintViolationRates.deadline.value, 0);
  assert.equal(result.constraintViolationRates.deadline.denominator, 1, 'unknown dimension is not an implicit pass');
  assert.equal(result.constraintAssessmentCoverage.deadline.unknown, 2);
  assert.equal(scoreRanking(['strong', 'good', 'weak', 'wrong'], qrels, 4).ndcg.value, 1);
});

test('unjudged qrels do not become negative gold; metric availability depends on needed evidence', () => {
  const labels = [...qrels, { jobId: 'unjudged', relevance: null, eligibility: 'unknown' } as RankingJudgment];
  const result = scoreRanking(['good', 'unjudged', 'strong'], labels, 3);
  assert.equal(result.precision.value, null);
  assert.equal(result.recall.value, null);
  assert.equal(result.ndcg.value, null);
  assert.equal(result.mrr.value, 1, 'unknown after a known first hit cannot change first-hit rank');
  assert.equal(result.coverage.unjudgedReturned, 1);
  assert.equal(result.coverage.unjudgedCorpus, 1);
  assert.equal(scoreRanking(['unjudged', 'good'], labels, 2).mrr.value, null);
  const outside = scoreRanking(['strong', 'good'], labels, 2);
  assert.equal(outside.precision.value, 1);
  assert.equal(outside.recall.value, null);
});

test('missing ranked IDs remain unjudged and empty slots penalize fixed-cutoff precision', () => {
  const missing = scoreRanking(['not-in-qrels', 'good'], qrels, 5);
  assert.equal(missing.coverage.corpusSize, 5);
  assert.equal(missing.coverage.unjudgedCorpus, 1);
  assert.equal(missing.precision.value, null);
  const short = scoreRanking(['strong'], qrels, 10);
  assert.equal(short.precision.value, 0.1);
  assert.equal(short.precision.denominator, 10);
  assert.equal(short.recall.value, 0.5);
  assert.equal(short.coverage.missingSlots, 9);
  const empty = scoreRanking([], qrels, 10);
  assert.equal(empty.precision.value, 0);
  assert.equal(empty.recall.value, 0);
  assert.equal(empty.mrr.value, 0);
  assert.equal(empty.eligibilityViolationRate.value, null);
});

test('zero-positive gold and unassessed eligibility have explicit not-applicable metrics', () => {
  const result = scoreRanking(['zero'], [{ jobId: 'zero', relevance: 0, eligibility: 'unknown' }], 2);
  assert.equal(result.recall.value, null);
  assert.equal(result.ndcg.value, null);
  assert.equal(result.recall.reason, 'no-relevant-gold');
  assert.equal(result.ndcg.reason, 'zero-ideal-gain');
  assert.equal(result.eligibilityViolationRate.denominator, 0);
  assert.equal(result.coverage.unknownEligibility, 1);
});

test('duplicate ranks, duplicate qrels, malformed labels, and invalid K are rejected', () => {
  assert.throws(() => scoreRanking(['good', 'good'], qrels), /unique/);
  assert.throws(() => scoreRanking([], [...qrels, qrels[0]!]), /unique/);
  for (const k of [0, -1, 1.1, Number.NaN, Infinity, 100001]) assert.throws(() => scoreRanking([], qrels, k), /K must/);
  assert.throws(() => scoreRanking([], [{ jobId: 'x', relevance: 4, eligibility: 'unknown' } as unknown as RankingJudgment]), /Relevance/);
  assert.throws(() => scoreRanking([], [{ jobId: 'x', relevance: 2, eligibility: 'eligible', violations: ['region'] }]), /ineligible/);
});
