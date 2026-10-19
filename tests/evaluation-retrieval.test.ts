import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRetrievalIndex, lexicalTokens, evaluateRetrieval, summarizeRetrieval,
  type RetrievalDocument, type RetrievalContext } from '../packages/evaluation/src/retrieval.js';

const job = (id: string, title: string, text = title): RetrievalDocument => ({ id, sourceId: 'official-jobs', entityId: id,
  kind: 'public-job', title, text, scope: { type: 'public' } });
const fact = (id: string, entityId = 'project-a'): RetrievalDocument => ({ id, sourceId: 'fictional-resume', entityId,
  kind: 'confirmed-fact', title: '项目角色', text: '检索增强生成 RAG 主要开发者', scope: { type: 'profile' },
  profileVersion: 4, recordVersion: 2, confirmedVersion: 2 });
const context: RetrievalContext = { profileVersion: 4, entityVersions: { 'project-a': 2, 'project-b': 1 }, applicationId: 'application-a' };

test('lexical baseline tokenizes mixed Chinese/English deterministically without inventing semantic matches', () => {
  assert.deepEqual(lexicalTokens('RAG 人工智能 ＡＩ'), ['rag', '人', '工', '智', '能', '人工', '工智', '智能', 'ai']);
  const index = new LocalRetrievalIndex([job('a', '人工智能算法实习生'), job('b', '财务审计'), job('c', 'RAG Engineer')]);
  assert.equal(index.search('人工智能 算法', { k: 2 })[0]?.document.id, 'a');
  assert.equal(index.search('RAG', { k: 2 })[0]?.document.id, 'c');
  assert.deepEqual(index.search('banana', { k: 10 }), []);
  assert.deepEqual(index.search('!!!', { k: 10 }), []);
  assert.throws(() => index.search('算法', { k: 0 }), /cutoff/);
});

test('confirmed private facts require exact profile, entity and confirmed revision and remain isolated by destination', () => {
  const answer = { ...fact('answer'), kind: 'confirmed-answer' as const, scope: { type: 'application' as const, applicationId: 'application-a' } };
  const unconfirmed = { ...fact('draft'), confirmedVersion: 1 };
  const index = new LocalRetrievalIndex([fact('fact'), answer, unconfirmed]);
  assert.deepEqual(index.search('RAG', { k: 10 }), []);
  assert.deepEqual(index.search('RAG', { k: 10, context }).map(item => item.document.id), ['answer', 'fact']);
  assert.deepEqual(index.search('RAG', { k: 10, context: { ...context, applicationId: 'application-b' } }).map(item => item.document.id), ['fact']);
  assert.deepEqual(index.search('RAG', { k: 10, context: { ...context, profileVersion: 5 } }), []);
  assert.deepEqual(index.search('RAG', { k: 10, context: { ...context, entityVersions: { 'project-a': 3 } } }), []);
  assert.deepEqual(index.search('RAG', { k: 10, context: { ...context, entityVersions: {} } }), []);
});

test('entity/source/kind filters are applied before ranking; disallowed private documents cannot affect scores', () => {
  const a = job('a', 'RAG 数据库'); const b = job('b', 'RAG agent');
  const baseline = new LocalRetrievalIndex([a, b]); const withPrivate = new LocalRetrievalIndex([a, b, fact('private')]);
  assert.deepEqual(withPrivate.search('RAG', { k: 5 }), baseline.search('RAG', { k: 5 }));
  assert.deepEqual(withPrivate.search('RAG', { k: 5, entityIds: ['b'] }).map(item => item.document.id), ['b']);
  assert.deepEqual(withPrivate.search('RAG', { k: 5, sourceIds: ['missing'] }), []);
  assert.deepEqual(withPrivate.search('RAG', { k: 5, context, kinds: ['confirmed-fact'] }).map(item => item.document.id), ['private']);
  assert.deepEqual(withPrivate.search('RAG', { k: 5, entityIds: [] }), []);
});

test('replacement is atomic, corpus hash is order invariant and returned documents cannot mutate the index', () => {
  const a = job('a', 'RAG'); const b = job('b', 'RAG');
  const index = new LocalRetrievalIndex([b, a]);
  assert.deepEqual(index.manifest(), new LocalRetrievalIndex([a, b]).manifest());
  assert.deepEqual(index.search('RAG', { k: 2 }).map(item => item.document.id), ['a', 'b']);
  index.search('RAG', { k: 1 })[0]!.document.text = 'MUTATED'; a.text = 'INPUT-MUTATED';
  assert.equal(index.search('RAG', { k: 1 })[0]?.document.text, 'RAG');
  const before = index.manifest();
  assert.throws(() => index.replace([b, b]), /corpus/); assert.deepEqual(index.manifest(), before);
  assert.throws(() => index.replace([{ ...fact('bad'), profileVersion: undefined }]), /corpus/);
  assert.throws(() => index.replace([{ ...fact('bad'), scope: { type: 'public' } }]), /corpus/);
});

test('local index persists/reloads evidence metadata and detects corruption with private file permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offerflash-retrieval-'));
  try {
    const path = join(directory, 'index.json'); const original = new LocalRetrievalIndex([job('job-a', 'RAG 工程师'), fact('fact')]);
    await original.save(path); assert.equal((await stat(path)).mode & 0o777, 0o600);
    const loaded = await LocalRetrievalIndex.load(path);
    assert.deepEqual(loaded.manifest(), original.manifest());
    assert.deepEqual(loaded.search('RAG', { k: 10, context }), original.search('RAG', { k: 10, context }));
    const serialized = JSON.parse(await readFile(path, 'utf8')); serialized.documents[0].text = 'corruption';
    await writeFile(path, JSON.stringify(serialized)); await assert.rejects(() => LocalRetrievalIndex.load(path), /corpus/);
    await writeFile(path, '{'); await assert.rejects(() => LocalRetrievalIndex.load(path), /corpus/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('persistence refuses direct file and directory symlinks rather than reading or overwriting their targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offerflash-retrieval-'));
  try {
    const index = new LocalRetrievalIndex([job('a', 'RAG')]); const target = join(directory, 'target.json');
    await index.save(target); const before = await readFile(target, 'utf8');
    const link = join(directory, 'link.json'); await symlink(target, link);
    await assert.rejects(() => index.save(link)); await assert.rejects(() => LocalRetrievalIndex.load(link));
    const dirlink = join(directory, 'dirlink'); await symlink(directory, dirlink);
    await assert.rejects(() => index.save(join(dirlink, 'target.json'))); await assert.rejects(() => LocalRetrievalIndex.load(join(dirlink, 'target.json')));
    assert.equal(await readFile(target, 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retrieval metrics match hand-computed graded rankings, with recall denominator over all relevant gold', () => {
  const metrics = evaluateRetrieval(['noise', 'b', 'a'], [{ documentId: 'a', grade: 3 }, { documentId: 'b', grade: 1 }, { documentId: 'c', grade: 2 }], 2);
  assert.equal(metrics.status, 'evaluated'); assert.equal(metrics.hitAtK, 1); assert.equal(metrics.recallAtK, 1 / 3);
  assert.equal(metrics.reciprocalRankAtK, 1 / 2); assert.equal(metrics.judgedReturnedFraction, 1 / 2);
  assert.ok(Math.abs(metrics.ndcgAtK! - (1 / Math.log2(3)) / (7 + 3 / Math.log2(3))) < 1e-12);
  const perfect = evaluateRetrieval(['a', 'c', 'b'], [{ documentId: 'a', grade: 3 }, { documentId: 'b', grade: 1 }, { documentId: 'c', grade: 2 }], 3);
  assert.equal(perfect.ndcgAtK, 1); assert.equal(perfect.recallAtK, 1);
  const miss = evaluateRetrieval([], [{ documentId: 'a', grade: 1 }], 3);
  assert.equal(miss.hitAtK, 0); assert.equal(miss.ndcgAtK, 0); assert.equal(miss.judgedReturnedFraction, null);
});

test('missing or zero-relevant gold is null and visibly excluded, never promoted to perfect retrieval', () => {
  const missing = evaluateRetrieval(['a'], null, 5); const empty = evaluateRetrieval(['a'], [], 5);
  const allNegative = evaluateRetrieval(['a'], [{ documentId: 'a', grade: 0 }], 5);
  assert.equal(missing.status, 'missing-gold'); assert.equal(missing.hitAtK, null);
  assert.equal(empty.status, 'no-relevant-gold'); assert.equal(empty.recallAtK, null);
  assert.equal(allNegative.ndcgAtK, null); assert.equal(allNegative.relevantCount, 0);
  const hit = evaluateRetrieval(['a'], [{ documentId: 'a', grade: 1 }], 5);
  const miss = evaluateRetrieval(['b'], [{ documentId: 'a', grade: 1 }], 5);
  const summary = summarizeRetrieval([missing, empty, hit, miss]);
  assert.deepEqual(summary, { queryCount: 4, evaluatedQueries: 2, missingGoldQueries: 1, noRelevantGoldQueries: 1,
    hitAtK: 0.5, recallAtK: 0.5, mrrAtK: 0.5, ndcgAtK: 0.5 });
  assert.equal(summarizeRetrieval([missing, empty]).hitAtK, null);
});

test('duplicate results/judgments, invalid grades and mixed cutoffs fail instead of inflating ranking quality', () => {
  assert.throws(() => evaluateRetrieval(['a', 'a'], [{ documentId: 'a', grade: 1 }], 5), /ranking/);
  assert.throws(() => evaluateRetrieval(['a'], [{ documentId: 'a', grade: 1 }, { documentId: 'a', grade: 2 }], 5), /judgments/);
  assert.throws(() => evaluateRetrieval(['a'], [{ documentId: 'a', grade: -1 }], 5), /judgments/);
  assert.throws(() => evaluateRetrieval(['a'], [{ documentId: 'a', grade: 4 }], 5), /judgments/);
  assert.throws(() => summarizeRetrieval([evaluateRetrieval([], null, 1), evaluateRetrieval([], null, 5)]), /cutoffs/);
  assert.throws(() => summarizeRetrieval([{ ...evaluateRetrieval(['a'], [{ documentId: 'a', grade: 1 }], 5), hitAtK: NaN }]), /metrics/);
  assert.throws(() => summarizeRetrieval([{ ...evaluateRetrieval(['a'], null, 5), hitAtK: 1 }]), /metrics/);
});
