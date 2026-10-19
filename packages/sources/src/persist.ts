import { randomUUID } from 'node:crypto';
import type { DomainStore } from '../../domain/src/store.js';
import type { AppState, SourceCollectionResult, SourceDefinition } from '../../shared/src/contracts.js';

/** A run report and its jobs commit together. Cancellation still retains the collected prefix. */
export async function persistSourceCollection(store: DomainStore, result: SourceCollectionResult, source: Pick<SourceDefinition, 'id' | 'name'>): Promise<AppState> {
  const message = result.report.errors.map(item => item.message).join('；').slice(0, 5000);
  return store.importCollectedJobs(result.jobs, {
    id: randomUUID(), sourceId: source.id, sourceName: source.name, status: result.report.status,
    count: result.jobs.length, observedAt: new Date().toISOString(), report: result.report,
    ...(message ? { error: message } : result.report.status === 'failed' ? { error: '没有取得可核对的岗位，请查看采集范围与停止原因。' } : {}),
  });
}
