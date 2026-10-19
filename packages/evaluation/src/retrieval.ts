import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** An owned, lexical retrieval baseline. No embeddings, network, model, or production data access. */
export const RETRIEVAL_VERSION = 'offerflash-lexical-bm25-v1';
export type RetrievalScope = { type: 'public' } | { type: 'profile' } | { type: 'application'; applicationId: string };
export interface RetrievalDocument {
  id: string; sourceId: string; entityId: string;
  kind: 'public-job' | 'confirmed-fact' | 'confirmed-answer';
  title: string; text: string; scope: RetrievalScope;
  /** For private ordinary facts: all three versions must match current host-confirmed facts. */
  profileVersion?: number; recordVersion?: number; confirmedVersion?: number;
}
export interface RetrievalContext {
  profileVersion: number;
  entityVersions: Readonly<Record<string, number>>;
  applicationId?: string;
}
export interface RetrievalOptions {
  k: number; context?: RetrievalContext;
  sourceIds?: readonly string[]; entityIds?: readonly string[];
  kinds?: readonly RetrievalDocument['kind'][];
}
export interface RetrievalHit {
  document: RetrievalDocument; score: number;
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const kValue = (k: number) => { if (!Number.isSafeInteger(k) || k < 1 || k > 10_000) throw new Error('Invalid retrieval cutoff.'); };
const fail = (): never => { throw new Error('Invalid retrieval corpus.'); };
function document(value: RetrievalDocument): RetrievalDocument {
  if (!value || !id(value.id) || !id(value.sourceId) || !id(value.entityId)
    || !['public-job', 'confirmed-fact', 'confirmed-answer'].includes(value.kind)
    || typeof value.title !== 'string' || value.title.length > 1000 || typeof value.text !== 'string'
    || !value.text.trim() || value.text.length > 100_000 || !value.scope) fail();
  if (!['public', 'profile', 'application'].includes(value.scope.type)) fail();
  if (value.scope.type === 'application' && !id(value.scope.applicationId)) fail();
  if (value.kind === 'public-job' ? value.scope.type !== 'public' : value.scope.type === 'public') fail();
  if (value.kind !== 'public-job' && ![value.profileVersion, value.recordVersion, value.confirmedVersion].every(version)) fail();
  // Store a strict projection: unknown properties cannot silently become a data-export channel.
  return { id: value.id, sourceId: value.sourceId, entityId: value.entityId, kind: value.kind,
    title: value.title, text: value.text,
    scope: value.scope.type === 'application' ? { type: 'application', applicationId: value.scope.applicationId } : { type: value.scope.type },
    ...(value.kind === 'public-job' ? {} : { profileVersion: value.profileVersion, recordVersion: value.recordVersion, confirmedVersion: value.confirmedVersion }) };
}

/** Deterministic Chinese characters+bigrams and Latin words; deliberately no semantic synonym expansion. */
export function lexicalTokens(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];
  for (const part of normalized.match(/[\p{Script=Han}]+|[a-z0-9]+(?:[+#.-][a-z0-9+#]+)*/gu) ?? []) {
    if (/\p{Script=Han}/u.test(part)) {
      const chars = Array.from(part); tokens.push(...chars);
      for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i]! + chars[i + 1]!);
    } else tokens.push(part);
  }
  return tokens;
}
const frequencies = (tokens: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};
function allowed(doc: RetrievalDocument, options: RetrievalOptions): boolean {
  if (options.sourceIds && !options.sourceIds.includes(doc.sourceId)) return false;
  if (options.entityIds && !options.entityIds.includes(doc.entityId)) return false;
  if (options.kinds && !options.kinds.includes(doc.kind)) return false;
  if (doc.kind === 'public-job') return true;
  const context = options.context;
  return !!context && version(context.profileVersion) && context.profileVersion === doc.profileVersion
    && Object.hasOwn(context.entityVersions, doc.entityId)
    && context.entityVersions[doc.entityId] === doc.recordVersion && doc.recordVersion === doc.confirmedVersion
    && (doc.scope.type !== 'application' || doc.scope.applicationId === context.applicationId);
}

export class LocalRetrievalIndex {
  private documents: RetrievalDocument[] = [];
  constructor(documents: readonly RetrievalDocument[] = []) { this.replace(documents); }
  replace(documents: readonly RetrievalDocument[]): void {
    if (!Array.isArray(documents) || documents.length > 10_000) fail();
    const next = documents.map(document).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(next.map(item => item.id)).size !== next.length) fail();
    if (next.reduce((sum, item) => sum + item.text.length + item.title.length, 0) > 8_000_000
      || Buffer.byteLength(JSON.stringify(next), 'utf8') > 24_000_000) fail();
    this.documents = next;
  }
  manifest(): { version: string; documentCount: number; corpusHash: string } {
    return { version: RETRIEVAL_VERSION, documentCount: this.documents.length,
      corpusHash: createHash('sha256').update(JSON.stringify(this.documents)).digest('hex') };
  }
  search(query: string, options: RetrievalOptions): RetrievalHit[] {
    kValue(options.k);
    if (typeof query !== 'string' || query.length > 10_000) throw new Error('Invalid retrieval query.');
    const terms = [...new Set(lexicalTokens(query))]; if (!terms.length) return [];
    // Filter before computing document frequencies: disallowed private text cannot affect public rankings.
    const corpus = this.documents.filter(doc => allowed(doc, options)).map(doc => {
      const tokens = lexicalTokens(`${doc.title} ${doc.text}`);
      return { doc, counts: frequencies(tokens), length: tokens.length };
    });
    if (!corpus.length) return [];
    const averageLength = corpus.reduce((sum, item) => sum + item.length, 0) / corpus.length || 1;
    const df = new Map(terms.map(term => [term, corpus.filter(item => item.counts.has(term)).length]));
    const hits = corpus.map(item => {
      let score = 0;
      for (const term of terms) {
        const tf = item.counts.get(term) ?? 0; if (!tf) continue;
        const n = df.get(term)!;
        const inverse = Math.log(1 + (corpus.length - n + 0.5) / (n + 0.5));
        score += inverse * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * item.length / averageLength));
      }
      return { document: structuredClone(item.doc), score };
    });
    return hits.filter(hit => hit.score > 0).sort((a, b) => b.score - a.score
      || (a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0)).slice(0, options.k);
  }
  /** Plain local benchmark corpus, mode 0600. Not a vault; never use for credentials/identity documents. */
  async save(path: string): Promise<void> {
    const parent = dirname(path); await mkdir(parent, { recursive: true, mode: 0o700 });
    const parentInfo = await lstat(parent); if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) fail();
    try { const existing = await lstat(path); if (!existing.isFile() || existing.isSymbolicLink()) fail(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(JSON.stringify({ ...this.manifest(), documents: this.documents })); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  static async load(path: string): Promise<LocalRetrievalIndex> {
    const parentInfo = await lstat(dirname(path)); if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) fail();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat(); if (!info.isFile() || info.size > 32_000_000) fail();
      let data: Record<string, unknown>;
      try { data = JSON.parse(await file.readFile('utf8')) as Record<string, unknown>; } catch { fail(); }
      if (!data! || data!.version !== RETRIEVAL_VERSION || !Array.isArray(data!.documents)) fail();
      const index = new LocalRetrievalIndex(data!.documents as RetrievalDocument[]);
      if (index.manifest().corpusHash !== data!.corpusHash || index.manifest().documentCount !== data!.documentCount) fail();
      return index;
    } finally { await file.close(); }
  }
}

export interface RetrievalJudgment { documentId: string; grade: number }
export interface RetrievalMetrics {
  k: number; status: 'evaluated' | 'missing-gold' | 'no-relevant-gold';
  relevantCount: number | null; retrievedCount: number;
  hitAtK: number | null; recallAtK: number | null; reciprocalRankAtK: number | null; ndcgAtK: number | null;
  /** Fraction of actual returned top-k IDs with a supplied judgment, not a substitute for retrieval quality. */
  judgedReturnedFraction: number | null;
}
/** Binary relevance >=1; graded nDCG uses gain 2^grade-1 and log2(rank+1). Unjudged IDs contribute zero. */
export function evaluateRetrieval(rankedIds: readonly string[], qrels: readonly RetrievalJudgment[] | null | undefined, k: number): RetrievalMetrics {
  kValue(k);
  if (rankedIds.some(item => !id(item)) || new Set(rankedIds).size !== rankedIds.length) throw new Error('Invalid retrieval ranking.');
  const top = rankedIds.slice(0, k);
  const empty = { k, relevantCount: null, retrievedCount: top.length, hitAtK: null, recallAtK: null,
    reciprocalRankAtK: null, ndcgAtK: null, judgedReturnedFraction: null };
  if (qrels == null) return { ...empty, status: 'missing-gold' };
  if (!Array.isArray(qrels) || qrels.some(item => !id(item.documentId) || !Number.isInteger(item.grade) || item.grade < 0 || item.grade > 3)
    || new Set(qrels.map(item => item.documentId)).size !== qrels.length) throw new Error('Invalid retrieval judgments.');
  const grades = new Map(qrels.map(item => [item.documentId, item.grade]));
  const relevantCount = qrels.filter(item => item.grade >= 1).length;
  const judgedReturnedFraction = top.length ? top.filter(item => grades.has(item)).length / top.length : null;
  if (!relevantCount) return { ...empty, relevantCount, judgedReturnedFraction, status: 'no-relevant-gold' };
  const ranks = top.flatMap((item, position) => (grades.get(item) ?? 0) >= 1 ? [position + 1] : []);
  const dcg = (values: readonly number[]) => values.reduce((sum, grade, position) => sum + (2 ** grade - 1) / Math.log2(position + 2), 0);
  const ideal = qrels.map(item => item.grade).sort((a, b) => b - a).slice(0, k);
  return { k, status: 'evaluated', relevantCount, retrievedCount: top.length, judgedReturnedFraction,
    hitAtK: ranks.length ? 1 : 0, recallAtK: ranks.length / relevantCount, reciprocalRankAtK: ranks.length ? 1 / ranks[0]! : 0,
    ndcgAtK: dcg(top.map(item => grades.get(item) ?? 0)) / dcg(ideal) };
}

export function summarizeRetrieval(metrics: readonly RetrievalMetrics[]): {
  queryCount: number; evaluatedQueries: number; missingGoldQueries: number; noRelevantGoldQueries: number;
  hitAtK: number | null; recallAtK: number | null; mrrAtK: number | null; ndcgAtK: number | null;
} {
  for (const metric of metrics) {
    kValue(metric.k);
    if (!['evaluated', 'missing-gold', 'no-relevant-gold'].includes(metric.status)
      || !Number.isSafeInteger(metric.retrievedCount) || metric.retrievedCount < 0 || metric.retrievedCount > metric.k
      || (metric.judgedReturnedFraction !== null && (!Number.isFinite(metric.judgedReturnedFraction)
        || metric.judgedReturnedFraction < 0 || metric.judgedReturnedFraction > 1))) throw new Error('Invalid retrieval metrics.');
    const values = [metric.hitAtK, metric.recallAtK, metric.reciprocalRankAtK, metric.ndcgAtK];
    if (metric.status === 'evaluated' ? (!version(metric.relevantCount)
      || values.some(value => value === null || !Number.isFinite(value) || value < 0 || value > 1)
      || ![0, 1].includes(metric.hitAtK!)) : (values.some(value => value !== null)
      || (metric.status === 'missing-gold' ? metric.relevantCount !== null : metric.relevantCount !== 0))) throw new Error('Invalid retrieval metrics.');
  }
  if (new Set(metrics.map(item => item.k)).size > 1) throw new Error('Cannot average different retrieval cutoffs.');
  const valid = metrics.filter(item => item.status === 'evaluated');
  const mean = (key: 'hitAtK' | 'recallAtK' | 'reciprocalRankAtK' | 'ndcgAtK') => valid.length
    ? valid.reduce((sum, item) => sum + item[key]!, 0) / valid.length : null;
  return { queryCount: metrics.length, evaluatedQueries: valid.length,
    missingGoldQueries: metrics.filter(item => item.status === 'missing-gold').length,
    noRelevantGoldQueries: metrics.filter(item => item.status === 'no-relevant-gold').length,
    hitAtK: mean('hitAtK'), recallAtK: mean('recallAtK'), mrrAtK: mean('reciprocalRankAtK'), ndcgAtK: mean('ndcgAtK') };
}
