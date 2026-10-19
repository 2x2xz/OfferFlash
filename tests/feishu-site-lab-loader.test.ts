import assert from 'node:assert/strict';
import test from 'node:test';
import { runFeishuSiteLab, type FeishuSiteLabContext } from '../apps/desktop/feishu-site-lab.js';
import { createCareerFormFixtureProfile, fixtureStrings } from '../apps/desktop/fixtures/career-form-profile.js';

function context(url: string): FeishuSiteLabContext {
  return {
    window: { isDestroyed: () => false },
    view: { webContents: { isDestroyed: () => false, getURL: () => url } },
    directory: '/not-accessed-in-guard-test', getGeneration: () => 1,
  } as unknown as FeishuSiteLabContext;
}

test('site lab loader refuses ordinary app invocations and a different origin before reading engine code', async () => {
  const original = [...process.argv];
  try {
    process.argv = ['node', 'fixture'];
    await assert.rejects(runFeishuSiteLab(context('https://modelbest.jobs.feishu.cn/apply')), /SITE_ADAPTER_LAB_REQUIRED/);
    process.argv = ['node', 'fixture', '--site-diagnostic', '--site-adapter-lab'];
    await assert.rejects(runFeishuSiteLab(context('https://unrelated.example.invalid/apply')), /SITE_ADAPTER_LAB_ORIGIN_REQUIRED/);
    await assert.rejects(runFeishuSiteLab(context('https://modelbest.jobs.feishu.cn.unrelated.example.invalid/apply')), /SITE_ADAPTER_LAB_ORIGIN_REQUIRED/);
    process.argv.push('--smoke-test');
    await assert.rejects(runFeishuSiteLab(context('https://modelbest.jobs.feishu.cn/apply')), /SITE_ADAPTER_LAB_REQUIRED/);
  } finally { process.argv = original; }
});

test('career lab fixtures have two distinct confirmed records per supported collection and exact month dates', () => {
  const profile = createCareerFormFixtureProfile();
  for (const collection of ['educations', 'internships', 'projects'] as const) {
    const records = profile.career![collection];
    assert.equal(records.length, 2);
    assert.equal(new Set(records.map(record => record.id)).size, 2);
    for (const record of records) {
      assert.equal(record.confirmation, 'confirmed'); assert.equal(record.confirmedRevision, record.revision);
      assert.ok(record.confirmedAt); assert.match(record.startDate, /^\d{4}-\d{2}$/); assert.match(record.endDate, /^\d{4}-\d{2}$/);
      assert.ok(record.startDate < record.endDate); assert.match(record.description, /虚构/);
    }
  }
  const master = profile.career!.educations.find(record => record.id === profile.career!.primaryEducationId)!;
  assert.equal(master.degree, '硕士'); assert.equal(master.startDate, '2025-09'); assert.equal(master.endDate, '2027-06');
  assert.equal(profile.school, master.school);
  for (const project of profile.career!.projects) assert.equal(new URL(project.url).hostname, 'example.invalid');
});

test('fixture query guard strings include fake record values without IDs or shared mutable record objects', () => {
  const profile = createCareerFormFixtureProfile(); const strings = fixtureStrings(profile);
  for (const collection of ['educations', 'internships', 'projects'] as const) {
    for (const record of profile.career![collection]) {
      assert.ok(strings.includes(record.description)); assert.ok(strings.includes(record.startDate)); assert.ok(strings.includes(record.endDate));
      assert.equal(strings.includes(record.id), false);
    }
  }
  for (const project of profile.career!.projects) assert.ok(strings.includes(project.url));
  assert.ok(strings.includes(profile.email)); assert.ok(strings.includes(profile.phone));
  profile.career!.educations[0]!.description = 'only this object';
  assert.match(createCareerFormFixtureProfile().career!.educations[0]!.description, /虚构硕士/);
});
