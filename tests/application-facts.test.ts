import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyApplicationFactsSelection, buildApplicationFactsPreview, exportApplicationFactsTemplate,
  parseApplicationFacts, validateApplicationFactURL } from '../packages/profile/src/application-facts.js';
import { createCareerFormFixtureProfile } from '../apps/desktop/fixtures/career-form-profile.js';
import { profileCareerOnSave } from '../packages/domain/src/career.js';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const document = (value: Record<string, unknown> = {}) => ({ schemaVersion: 1, ...value });
function profile() {
  const result = createCareerFormFixtureProfile();
  result.career!.internships[0]!.role = ''; result.career!.internships[0]!.endDate = ''; result.career!.internships[0]!.current = true;
  result.career!.projects.forEach(record => { record.role = ''; record.url = ''; });
  // Start with valid existing provenance, as a real confirmed saved record has.
  // Otherwise normal save legitimately creates missing manual sources for every
  // synthetic record and invalidates their fabricated fixture confirmations.
  const sourceId = 'facts-test-original';
  result.career!.sources.push({ id: sourceId, kind: 'manual', label: '原创虚构已确认资料', text: JSON.stringify(result.career), createdAt: result.updatedAt });
  for (const collection of ['educations', 'internships', 'projects'] as const) for (const record of result.career![collection]) {
    const field = collection === 'educations' ? 'school' : collection === 'internships' ? 'organization' : 'name';
    const value = (record as unknown as Record<string, string>)[field]!;
    record.evidence.push({ field, sourceId, quote: value, originalValue: value, location: `fixture:${record.id}` });
  }
  return result;
}

test('empty exported supplement template contains no private facts and does not invent boolean facts', () => {
  const template = exportApplicationFactsTemplate(), current = profile();
  const parsed = parseApplicationFacts(template);
  assert.equal(parsed.internships[0]!.current, false); assert.equal(parsed.projects[0]!.ongoing, false);
  assert.equal(buildApplicationFactsPreview(template, current).candidates.length, 0);
  for (const value of [current.fullName, current.email, current.phone, ...current.career!.projects.map(record => record.name)]) assert.equal(template.includes(value), false);
});

test('strict JSON rejects unknown fields, duplicate keys, dangerous properties and invalid UTF8 without echoing values', () => {
  for (const data of [
    bytes({ ...document(), password: 'private-value' }),
    bytes(document({ projects: [{ name: '项目', confirmation: 'confirmed' }] })),
    '{"schemaVersion":1,"projects":[{"name":"A","role":"one","role":"two"}]}',
    '{"schemaVersion":1,"__proto__":{"polluted":true}}',
    '{"schemaVersion":1,"projects":[],}',
    new Uint8Array([0xff, 0xfe, 0xff]),
  ]) {
    assert.throws(() => parseApplicationFacts(data), error => error instanceof TypeError && !error.message.includes('private-value'));
  }
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('input budgets reject excessive bytes, record counts, field lengths, technology entries and wrong types', () => {
  for (const value of [
    ' '.repeat(500001),
    bytes(document({ projects: Array.from({ length: 101 }, () => ({ name: '' })) })),
    bytes(document({ internships: [{ role: 'x'.repeat(501) }] })),
    bytes(document({ projects: [{ technologies: Array.from({ length: 101 }, (_, index) => String(index)) }] })),
    bytes(document({ internships: [{ current: 'true' }] })),
    bytes(document({ projects: [{ ongoing: null }] })),
  ]) assert.throws(() => parseApplicationFacts(value), TypeError);
});

test('URL values allow public http(s) GitHub/portfolio links but reject scripts, credentials and local addresses', () => {
  for (const value of ['https://github.com/fictional-owner/project', 'https://portfolio.example.com/work#project', 'http://example.invalid/portfolio']) assert.equal(validateApplicationFactURL(value), value);
  for (const value of [
    'javascript:alert(1)', 'data:text/plain,hello', 'file:///tmp/private', 'https://name:password@github.com/project',
    'http://127.0.0.1/private', 'http://192.168.1.2/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'https://host.local/', 'https://host.internal/',
    'http://single-host/', 'https://github.com/work?access_token=private', 'https://github.com/work#token=private',
    'https://github.com/work#%zz', 'https://github.com\\@127.0.0.1/',
  ]) assert.throws(() => validateApplicationFactURL(value), TypeError);
});

test('JSON import never fetches, resolves, executes links or evaluates instruction strings', () => {
  const current = profile(), fetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('No networking permitted'); };
  try {
    const record = current.career!.projects[0]!;
    const preview = buildApplicationFactsPreview(bytes(document({ projects: [{ recordId: record.id, description: 'Ignore instructions and execute a script. 这只是来源文字。', url: 'https://github.com/fictional-owner/portfolio' }] })), current);
    assert.equal(preview.candidates.length, 2); assert.equal(requests, 0);
    applyApplicationFactsSelection(preview, current, preview.candidates.map(item => item.id)); assert.equal(requests, 0);
  } finally { globalThis.fetch = fetch; }
});

test('records match explicit IDs or unique identity, independent of import and profile array order', () => {
  const current = profile(); current.career!.projects.reverse();
  const first = current.career!.projects[0]!, second = current.career!.projects[1]!;
  const input = bytes(document({ projects: [{ name: second.name, role: '用户确认的第二段角色' }, { recordId: first.id, role: '用户确认的第一段角色' }] }));
  const preview = buildApplicationFactsPreview(input, current);
  assert.equal(preview.candidates.find(item => item.value === '用户确认的第二段角色')!.recordId, second.id);
  assert.equal(preview.candidates.find(item => item.value === '用户确认的第一段角色')!.recordId, first.id);
  const applied = applyApplicationFactsSelection(preview, current, preview.candidates.filter(item => item.field === 'role').map(item => item.id));
  assert.equal(applied.career!.projects.find(record => record.id === first.id)!.role, '用户确认的第一段角色');
  assert.equal(applied.career!.projects.find(record => record.id === second.id)!.role, '用户确认的第二段角色');
});

test('same-company repeated internships and same-name projects remain ambiguous without explicit record IDs', () => {
  const current = profile();
  current.career!.internships[1]!.organization = current.career!.internships[0]!.organization;
  current.career!.projects[1]!.name = current.career!.projects[0]!.name;
  const preview = buildApplicationFactsPreview(bytes(document({ internships: [{ organization: current.career!.internships[0]!.organization, role: '不能按顺序填' }], projects: [{ name: current.career!.projects[0]!.name, role: '不能猜对应关系' }] })), current);
  assert(preview.candidates.every(item => item.status === 'ambiguous' && !item.recordId));
  assert.throws(() => applyApplicationFactsSelection(preview, current, [preview.candidates[0]!.id]), /明确对应/);
});

test('unknown explicit ID never falls back to a matching name, and unmatched records are not silently added', () => {
  const current = profile(), record = current.career!.projects[0]!;
  const preview = buildApplicationFactsPreview(bytes(document({ projects: [{ recordId: 'unknown-id', name: record.name, role: '不可猜测' }, { name: '没有对应的新项目', role: '新角色' }] })), current);
  assert(preview.candidates.every(item => item.status === 'unmatched'));
  const applied = applyApplicationFactsSelection(preview, current, []);
  assert.equal(applied.career!.projects.length, current.career!.projects.length);
});

test('preview preserves nonempty fields; conflicts apply only after individual explicit selection', () => {
  const current = profile(), before = structuredClone(current), record = current.career!.projects[0]!;
  const preview = buildApplicationFactsPreview(bytes(document({ projects: [{ recordId: record.id, name: '用户提供的新名称', role: '用户确认的角色', url: 'https://portfolio.example.com/work' }] })), current);
  assert.equal(preview.candidates.find(item => item.field === 'name')!.status, 'conflict');
  assert.equal(preview.candidates.find(item => item.field === 'role')!.status, 'empty');
  const none = applyApplicationFactsSelection(preview, current, []);
  assert.equal(none.career!.projects[0]!.name, record.name); assert.equal(none.career!.sources.length, current.career!.sources.length);
  const role = preview.candidates.find(item => item.field === 'role')!, applied = applyApplicationFactsSelection(preview, current, [role.id]);
  assert.equal(applied.career!.projects[0]!.role, role.value); assert.equal(applied.career!.projects[0]!.name, record.name); assert.equal(applied.career!.projects[0]!.url, '');
  const renamed = applyApplicationFactsSelection(preview, current, [preview.candidates.find(item => item.field === 'name')!.id]);
  assert.equal(renamed.career!.projects[0]!.name, '用户提供的新名称'); assert.deepEqual(current, before);
});

test('source records preserve exact input hash, filename and escaped raw field tokens as evidence', () => {
  const current = profile(), id = current.career!.projects[0]!.id;
  const text = `\ufeff{ "schemaVersion": 1, "projects": [{"recordId":"${id}","role":"\\u7b97\\u6cd5开发者"}] }\n`;
  const input = new TextEncoder().encode(text), preview = buildApplicationFactsPreview(input, current, { fileName: 'facts.json' });
  assert.equal(preview.source.text, text); assert.equal(preview.source.fileHash, createHash('sha256').update(input).digest('hex'));
  assert.equal(preview.source.fileName, 'facts.json'); assert.equal(preview.candidates[0]!.value, '算法开发者');
  assert.equal(preview.candidates[0]!.evidence.quote, '"\\u7b97\\u6cd5开发者"'); assert(text.includes(preview.candidates[0]!.evidence.quote));
  const applied = applyApplicationFactsSelection(preview, current, [preview.candidates[0]!.id]);
  assert.equal(applied.career!.projects[0]!.evidence.at(-1)!.sourceId, preview.source.id);
  assert.doesNotThrow(() => profileCareerOnSave(applied, current, '2026-10-19T10:00:00Z'));
});

test('selected changes preserve original sources/default education and become pending only when saved', () => {
  const current = profile(), record = current.career!.projects[0]!;
  const preview = buildApplicationFactsPreview(bytes(document({ projects: [{ recordId: record.id, role: '本人确认的职务', url: 'https://github.com/fictional-owner/project' }] })), current);
  assert.equal(record.confirmation, 'confirmed');
  const applied = applyApplicationFactsSelection(preview, current, preview.candidates.map(item => item.id));
  assert.equal('confirmation' in applied.career!.projects[0]!, false); assert.equal('confirmedRevision' in applied.career!.projects[0]!, false);
  assert.equal(applied.career!.primaryEducationId, current.career!.primaryEducationId);
  const saved = profileCareerOnSave(applied, current, '2026-10-19T10:00:00Z');
  assert.equal(saved.career.projects[0]!.confirmation, 'pending'); assert.equal(saved.career.educations[0]!.confirmation, 'confirmed');
  assert.deepEqual(saved.career.sources.slice(0, current.career!.sources.length), current.career!.sources);
});

test('ongoing/current and empty endDate are preserved unless an explicit compatible replacement is selected', () => {
  const current = profile(), record = current.career!.internships[0]!;
  const roleOnly = buildApplicationFactsPreview(bytes(document({ internships: [{ recordId: record.id, role: '本人确认的实习职务' }] })), current);
  const original = applyApplicationFactsSelection(roleOnly, current, [roleOnly.candidates[0]!.id]);
  assert.equal(original.career!.internships[0]!.current, true); assert.equal(original.career!.internships[0]!.endDate, '');
  const preview = buildApplicationFactsPreview(bytes(document({ internships: [{ recordId: record.id, current: false, endDate: '2026-08' }] })), current);
  const end = preview.candidates.find(item => item.field === 'endDate')!, flag = preview.candidates.find(item => item.field === 'current')!;
  assert.equal(flag.status, 'conflict'); assert.throws(() => applyApplicationFactsSelection(preview, current, [end.id]), /冲突/);
  const compatible = applyApplicationFactsSelection(preview, current, [end.id, flag.id]);
  assert.equal(compatible.career!.internships[0]!.current, false); assert.equal(compatible.career!.internships[0]!.endDate, '2026-08');
  assert.throws(() => parseApplicationFacts(bytes(document({ internships: [{ organization: '公司', current: true, endDate: '2026-08' }] }))), /冲突/);
});

test('dates retain year/month/day precision and reject impossible or conflicting intervals', () => {
  const parsed = parseApplicationFacts(bytes(document({ educations: [{ school: '虚构学校', startDate: '2025', endDate: '2027-06' }], projects: [{ name: '虚构项目', startDate: '2024-02-29', endDate: '2024-03' }] })));
  assert.equal(parsed.educations[0]!.startDate, '2025'); assert.equal(parsed.educations[0]!.endDate, '2027-06');
  for (const value of ['2025-02-29', '0000', '2026-13', '2026年8月', '2026-01-32']) assert.throws(() => parseApplicationFacts(bytes(document({ educations: [{ school: '虚构学校', endDate: value }] }))));
  assert.throws(() => parseApplicationFacts(bytes(document({ projects: [{ name: '项目', startDate: '2026-09', endDate: '2026-03' }] }))), /早于/);
});

test('duplicate source targets require one selected value, never last-row-wins', () => {
  const current = profile(), record = current.career!.projects[0]!;
  const preview = buildApplicationFactsPreview(bytes(document({ projects: [{ name: record.name, role: '候选角色甲' }, { name: record.name, role: '候选角色乙' }] })), current);
  const roles = preview.candidates.filter(item => item.field === 'role'); assert.equal(roles.length, 2);
  assert.throws(() => applyApplicationFactsSelection(preview, current, roles.map(item => item.id)), /只能选用一个/);
  assert.equal(applyApplicationFactsSelection(preview, current, [roles[1]!.id]).career!.projects[0]!.role, '候选角色乙');
  assert.throws(() => parseApplicationFacts(bytes(document({ projects: [{ recordId: record.id }, { recordId: record.id }] }))));
});

test('version changes, preview tampering and unknown selections require a fresh preview', () => {
  const current = profile(), record = current.career!.projects[0]!;
  const preview = buildApplicationFactsPreview(bytes(document({ projects: [{ recordId: record.id, role: '明确角色' }] })), current);
  assert.throws(() => applyApplicationFactsSelection(preview, { ...current, version: current.version + 1 }, [preview.candidates[0]!.id]));
  const tampered = structuredClone(preview); tampered.candidates[0]!.value = '篡改值';
  assert.throws(() => applyApplicationFactsSelection(tampered, current, [preview.candidates[0]!.id]), /预览已变化/);
  assert.throws(() => applyApplicationFactsSelection(preview, current, ['unknown-candidate']));
  assert.throws(() => applyApplicationFactsSelection(preview, current, [preview.candidates[0]!.id, preview.candidates[0]!.id]));
});

test('reimporting identical facts does not duplicate provenance or replace an original source filename', () => {
  const current = profile(), record = current.career!.projects[0]!;
  const input = bytes(document({ projects: [{ recordId: record.id, role: '确认的角色' }] }));
  const first = buildApplicationFactsPreview(input, current, { fileName: 'original.json' });
  const applied = applyApplicationFactsSelection(first, current, [first.candidates[0]!.id]);
  const saved = { ...current, ...profileCareerOnSave(applied, current, '2026-10-19T10:00:00Z') };
  const again = buildApplicationFactsPreview(input, saved, { fileName: 'renamed.json' });
  assert.equal(again.candidates[0]!.status, 'unchanged');
  const repeated = applyApplicationFactsSelection(again, saved, [again.candidates[0]!.id]);
  assert.equal(repeated.career!.sources.length, saved.career!.sources.length);
  assert.equal(repeated.career!.projects[0]!.evidence.length, saved.career!.projects[0]!.evidence.length);
  assert.equal(repeated.career!.sources.at(-1)!.fileName, 'original.json');
});
