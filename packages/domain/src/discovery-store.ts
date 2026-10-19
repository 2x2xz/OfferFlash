import type { DiscoveryReport, DiscoverySourceInput, DiscoveryState } from '../../shared/src/discovery.js';
import { defaultDiscoverySources, registerDiscoverySource, validateDiscoverySource } from '../../sources/src/discovery-catalog.js';
import { readDocuments, writeDocument, deleteDocument, type DatabaseFile } from './sqlite.js';

export function createDiscoveryStore(file: DatabaseFile) {
  const state = (db: Parameters<Parameters<DatabaseFile['read']>[0]>[0]): DiscoveryState => {
    const sources = new Map(defaultDiscoverySources().map(source => [source.id, source]));
    for (const source of readDocuments<DiscoveryState['sources'][number]>(db, 'discovery_source')) sources.set(source.id, validateDiscoverySource(source));
    return { sources: [...sources.values()], runs: readDocuments<DiscoveryReport>(db, 'discovery_run').sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
  };
  return {
    getState: () => file.read(state),
    addSource(input: DiscoverySourceInput) {
      const source = registerDiscoverySource(input);
      return file.transact(db => {
        if (readDocuments(db, 'discovery_source').length >= 50 && !readDocuments<{ id: string }>(db, 'discovery_source').some(item => item.id === source.id)) throw new Error('招聘来源已达50个，请先使用已有来源。');
        writeDocument(db, 'discovery_source', source.id, source, new Date().toISOString()); return source;
      });
    },
    recordRun(report: DiscoveryReport) {
      return file.transact(db => {
        writeDocument(db, 'discovery_run', report.id, report, report.finishedAt);
        const runs = readDocuments<DiscoveryReport>(db, 'discovery_run').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        for (const old of runs.slice(20)) deleteDocument(db, 'discovery_run', old.id);
        return state(db);
      });
    },
  };
}
export type DiscoveryStore = ReturnType<typeof createDiscoveryStore>;
