import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainTools, validateDomainToolArguments } from '../packages/agent/src/tools.js';
test('profile discovery uses the existing controlled refresh tool with bounded profile-derived parameters', () => {
  validateDomainToolArguments('refresh_jobs', { sourceId: 'profile-discovery', maxPages: 2, detailLimit: 10 });
  for (const input of [{ keyword: 'a new guess' }, { maxPages: 6 }, { detailLimit: 31 }]) {
    assert.throws(() => validateDomainToolArguments('refresh_jobs', { sourceId: 'profile-discovery', ...input }));
  }
  validateDomainToolArguments('refresh_jobs', { sourceId: 'tencent-experienced', keyword: '算法', maxPages: 8 });
});
test('discovery tool accepts bounded multi-source scope but refuses a different returned source identity', async () => {
  const result = { jobs: [], totalMatched: 0, returnedCount: 0, offset: 0, nextOffset: null, hasMore: false,
    coverage: 'local-snapshot', profileVersion: 1, filters: { keyword: '', city: '', recruitmentType: null, eligibility: null },
    sourceRun: { id: 'discovery', sourceId: 'profile-discovery', sourceName: '已接入官网', status: 'partial', count: 0, observedAt: '2026-10-19T00:00:00Z' },
    discovery: { coverage: 'configured-official-sources', sourcesAttempted: 1, unviewedSources: 2, completeDetails: 0, scopeNote: '预算内未找到符合条件的岗位；其他来源未查。' } };
  const tool = createDomainTools(async () => result).find(item => item.name === 'refresh_jobs')!;
  await tool.execute('call', { sourceId: 'profile-discovery' }, undefined, undefined, {} as any);
  const wrong = createDomainTools(async () => ({ ...result, sourceRun: { ...result.sourceRun, sourceId: 'tencent-experienced' } })).find(item => item.name === 'refresh_jobs')!;
  await assert.rejects(wrong.execute('call', { sourceId: 'profile-discovery' }, undefined, undefined, {} as any), /刷新报告不属于/);
});
