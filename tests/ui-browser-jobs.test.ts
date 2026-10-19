import assert from 'node:assert/strict';
import test from 'node:test';
import { displayBrowserAddress, normalizeBrowserAddress } from '../packages/ui/src/browser-input.js';
import { formPreviewCounts, formPreviewRows, selectablePreviewIds } from '../packages/ui/src/form-preview.js';
import { eligibilityLabel, explicitJobCities, filterSavedJobs, jobMatchesCity } from '../packages/ui/src/job-filter.js';
import type { FillPlan, FillResult, Job } from '../packages/shared/src/contracts.js';

test('browser input accepts bare website addresses and ports but never treats credentials or privileged schemes as navigation', () => {
  assert.equal(normalizeBrowserAddress(' jobs.bytedance.com/campus/position '), 'https://jobs.bytedance.com/campus/position');
  assert.equal(normalizeBrowserAddress('localhost:3000/jobs'), 'https://localhost:3000/jobs');
  assert.equal(normalizeBrowserAddress('http://example.org/jobs?id=123#apply'), 'http://example.org/jobs?id=123#apply');
  assert.equal(normalizeBrowserAddress('example.org:8443/jobs'), 'https://example.org:8443/jobs');
  for (const input of ['', '   ', 'javascript:alert(1)', 'file:///tmp/fixture.html', 'data:text/html,test', 'https://name:password@example.org/jobs', 'name@example.org/jobs', 'https://example.org/\njob']) {
    assert.throws(() => normalizeBrowserAddress(input), Error, input);
  }
  assert.throws(() => normalizeBrowserAddress('腾讯校招'), /关键词/);
  assert.equal(displayBrowserAddress('about:blank'), '');
  assert.equal(displayBrowserAddress('file:///trusted/test-form.html'), 'file:///trusted/test-form.html', 'the existing fixture may be displayed or restored with Escape without authorizing new file navigation');
});

function plan(): FillPlan {
  return { id: 'preview-one', url: 'https://example.org/apply', title: '虚构样表', profileVersion: 1, observationId: 'observation-one', createdAt: '2026-10-12T00:00:00Z', items: [
    { fieldId: 'name', label: '姓名', status: 'ready', value: '虚构同学', currentValue: '', reason: '来自已确认资料' },
    { fieldId: 'degree', label: '学历', status: 'ready', value: 'master', currentValue: '', reason: '真实下拉选项' },
    { fieldId: 'email', label: '邮箱', status: 'skip', value: '', currentValue: 'existing@example.invalid', reason: '已有值，保留' },
    { fieldId: 'date', label: '具体毕业日期', status: 'review', value: '', currentValue: '', reason: '不能猜具体日期' },
  ] };
}
test('selection helpers only expose ready fields and partial results replace per-field status and reasons', () => {
  const original = plan(); const before = JSON.stringify(original);
  assert.deepEqual(selectablePreviewIds(original), ['name', 'degree']);
  assert.deepEqual(formPreviewCounts(original, ['name', 'name', 'email', 'date', 'unknown']), { ready: 2, selected: 1, kept: 1, review: 1, verified: 0, unresolved: 0 });
  assert.equal(formPreviewCounts(original, []).selected, 0);
  const result: FillResult = { planId: original.id, verified: [{ fieldId: 'name', label: '姓名' }], unresolved: [{ fieldId: 'degree', label: '学历', reason: '请你手动选择真实下拉选项' }] };
  const rows = formPreviewRows(original, result);
  assert.equal(rows[0]!.label, '已验证');
  assert.equal(rows[1]!.label, '未完成，需处理');
  assert.equal(rows[1]!.reason, '请你手动选择真实下拉选项');
  assert.equal(rows[2]!.item.currentValue, 'existing@example.invalid');
  assert.deepEqual(selectablePreviewIds(original, result), []);
  assert.deepEqual(formPreviewCounts(original, ['degree'], result), { ready: 0, selected: 0, kept: 1, review: 1, verified: 1, unresolved: 1 });
  assert.deepEqual(selectablePreviewIds(original, { ...result, planId: 'old-preview' }), ['name', 'degree'], 'an old result must not label a new preview with reused field ids');
  assert.equal(JSON.stringify(original), before, 'display and selection helpers never mutate the authorized plan');
});

function job(id: string, city: string, overrides: Partial<Job> = {}): Job {
  return { id, company: '虚构研究企业', title: '大模型研发', city, type: 'campus', description: 'Python RAG 应用', requirements: '', url: `https://example.invalid/${id}`, sourceId: 'fixture', sourceName: '虚构样本', publishedAt: null, observedAt: '2026-10-12T00:00:00Z', firstSeenAt: '2026-10-12T00:00:00Z', deadline: null, demo: true, match: { score: 80, eligible: 'review', reasons: [], concerns: ['资格待核对'], profileVersion: 1 }, ...overrides };
}
test('city filters match explicitly listed multiple cities without filling an unlisted fourth city', () => {
  assert.equal(jobMatchesCity('上海、杭州、深圳等 4 个城市', '杭州'), true);
  for (const cities of ['上海、杭州等城市', '上海、杭州等', '上海、杭州等多个城市', '上海、杭州等4个']) {
    assert.equal(jobMatchesCity(cities, '杭州'), true, cities);
    assert.equal(jobMatchesCity(cities, '北京'), false, 'an unspecified city must not be inferred');
    assert.deepEqual(explicitJobCities(cities), ['上海', '杭州']);
  }
  assert.equal(jobMatchesCity('上海、北京、深圳等 4 个城市', '杭州'), false);
  assert.equal(jobMatchesCity('杭州市，上海市', '杭州'), true);
  assert.equal(jobMatchesCity('城市待确认', '杭州'), false);
  assert.equal(jobMatchesCity('全国', '杭州'), false);
  assert.deepEqual(explicitJobCities('上海、北京、深圳等 4 个城市'), ['上海', '北京', '深圳']);
  const saved = [job('multiple', '上海、杭州、深圳'), job('partial', '上海、北京、深圳等4个城市'), job('experienced', '杭州', { type: 'experienced' })];
  const before = JSON.stringify(saved);
  assert.deepEqual(filterSavedJobs(saved, { city: '杭州', type: 'campus', query: '虚构 RAG' }).map(value => value.id), ['multiple']);
  assert.deepEqual(filterSavedJobs(saved, { city: '', type: '', query: '不存在的关键词' }), []);
  assert.equal(filterSavedJobs(saved, { city: '', type: '', query: '' }).length, 3, 'clearing filters restores the saved snapshot');
  assert.equal(JSON.stringify(saved), before);
  assert.equal(eligibilityLabel('likely'), '符合已知条件');
  assert.equal(eligibilityLabel('review'), '有条件待核对');
  assert.equal(eligibilityLabel('unsuitable'), '不符合已知条件');
});
