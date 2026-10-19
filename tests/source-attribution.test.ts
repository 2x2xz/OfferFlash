import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeBrowserJobs } from '../packages/sources/src/catalog.js';
import type { JobInput } from '../packages/shared/src/contracts.js';

test('browser source attribution preserves internships and refuses external-company attribution', () => {
  const job: JobInput = { company: '企业名称待确认', title: '算法实习生', city: '', type: 'internship', description: '', requirements: '', url: 'https://jobs.bytedance.com/campus/position/123', sourceId: 'browser:jobs.bytedance.com', sourceName: '官网', publishedAt: null, deadline: null, demo: false };
  const external = { ...job, url: 'https://example.invalid/job/456', type: 'unknown' as const };
  const result = attributeBrowserJobs([job, external], 'https://jobs.bytedance.com/campus/position');
  assert.equal(result[0]?.company, '字节跳动');
  assert.equal(result[0]?.sourceId, 'bytedance-campus');
  assert.equal(result[0]?.type, 'internship');
  assert.deepEqual(result[1], external);
  assert.deepEqual(attributeBrowserJobs([job], 'https://example.invalid/position'), [job]);
});
