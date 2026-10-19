import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxText, readResume } from '../packages/profile/src/import.js';
import { extractDocxContent } from '../packages/profile/src/docx.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
function document(body: string): string { return `<d:document xmlns:d="${W}" xmlns:r="${R}"><d:body>${body}</d:body></d:document>`; }
function paragraph(text: string): string { return `<d:p><d:r><d:t>${text}</d:t></d:r></d:p>`; }
function relation(id: string, type: string, target: string, external = false): string { return `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`; }
function relationships(content: string): string { return `<Relationships xmlns="${P}">${content}</Relationships>`; }
function archive(body: string, parts: Record<string, string> = {}): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries({ 'word/document.xml': document(body), ...parts }).map(([path, content]) => [path, strToU8(content)])));
}
async function imported(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-docx-structure-'));
  try {
    const path = join(directory, 'fictional.docx');
    await writeFile(path, bytes);
    const result = await readResume(path);
    assert.deepEqual(await readFile(path), Buffer.from(bytes), 'source document must stay unchanged');
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('DOCX table labels keep their values and adjacent styled runs stay contiguous with arbitrary namespace prefixes', async () => {
  const row = ['姓名', '测试同学', '手机', '13800138000', '毕业年月', '2027年6月'].map(value => `<d:tc>${paragraph(value)}</d:tc>`).join('');
  const bytes = archive(`<d:tbl><d:tr>${row}</d:tr></d:tbl><d:p><d:r><d:t>fictional</d:t></d:r><d:r><d:rPr><d:b/></d:rPr><d:t>@example.invalid</d:t></d:r></d:p>${paragraph('Python &amp; AI')}`);
  const result = await imported(bytes);
  assert.match(result.text!, /姓名：测试同学\t手机：13800138000\t毕业年月：2027年6月/);
  assert.equal(result.suggested?.fullName, '测试同学');
  assert.equal(result.suggested?.phone, '13800138000');
  assert.equal(result.suggested?.graduationMonth, '2027-06');
  assert.equal(result.suggested?.email, 'fictional@example.invalid');
  assert.match(result.text!, /Python & AI/);
  assert.ok(result.evidence?.some(value => value.field === 'fullName' && /表格 1 第 1 行/.test(value.source)));
  const defaultNS = zipSync({ 'word/document.xml': strToU8(`<document xmlns="${W}"><body><p><r><t>默认命名空间</t></r></p></body></document>`) });
  assert.equal(extractDocxText(defaultNS), '默认命名空间');
});

test('only referenced header/footer parts contribute candidates and conflicts never choose the first contact', async () => {
  const bytes = archive(`${paragraph('姓名：虚构同学')}<d:sectPr><d:headerReference r:id="head"/><d:footerReference r:id="foot"/></d:sectPr>`, {
    'word/_rels/document.xml.rels': relationships(relation('head', 'header', 'header1.xml') + relation('foot', 'footer', 'footer1.xml')),
    'word/header1.xml': `<d:hdr xmlns:d="${W}">${paragraph('邮箱：one@example.invalid')}${paragraph('手机：13800138000')}</d:hdr>`,
    'word/footer1.xml': `<d:ftr xmlns:d="${W}">${paragraph('邮箱：two@example.invalid')}${paragraph('手机：13900139000')}</d:ftr>`,
    'word/header99.xml': `<d:hdr xmlns:d="${W}">${paragraph('unreferenced@example.invalid')}</d:hdr>`,
  });
  const result = await imported(bytes);
  assert.equal(result.suggested?.email, undefined);
  assert.equal(result.suggested?.phone, undefined);
  assert.equal(result.suggested?.fullName, '虚构同学');
  assert.ok(result.warnings?.some(value => /多个不同的邮箱/.test(value)));
  assert.ok(result.warnings?.some(value => /多个不同的手机号/.test(value)));
  assert.ok(result.evidence?.some(value => /页眉/.test(value.source)));
  assert.ok(result.evidence?.some(value => /页脚/.test(value.source)));
  assert.doesNotMatch(result.text!, /unreferenced/);
});

test('tracked deletions and moveFrom content are excluded while inserted current content is retained', async () => {
  const result = await imported(archive(`<d:del>${paragraph('old@example.invalid')}</d:del><d:moveFrom>${paragraph('moved@example.invalid')}</d:moveFrom><d:p><d:del><d:r><d:delText>deleted@example.invalid</d:delText></d:r></d:del><d:ins><d:r><d:t>current@example.invalid</d:t></d:r></d:ins></d:p>`));
  assert.equal(result.suggested?.email, 'current@example.invalid');
  assert.equal(result.text, 'current@example.invalid');
  assert.deepEqual(result.warnings, []);
});

test('tracked deleted table rows and cells cannot supply contacts or shift surviving label/value pairs', async () => {
  const cell = (value: string, properties = '') => `<d:tc>${properties}${paragraph(value)}</d:tc>`;
  const deletedRow = `<d:tr><d:trPr><d:del d:id="1"/></d:trPr>${cell('邮箱')}${cell('deleted-row@example.invalid')}</d:tr>`;
  const mixedRow = `<d:tr>${cell('姓名')}${cell('已删除姓名', '<d:tcPr><d:cellDel d:id="2"/></d:tcPr>')}${cell('手机')}${cell('13800138000')}${cell('邮箱')}${cell('current@example.invalid')}</d:tr>`;
  const historicalRow = `<d:tr><d:trPr><d:trPrChange d:id="3"><d:trPr><d:del d:id="4"/></d:trPr></d:trPrChange></d:trPr>${cell('学校')}${cell('虚构大学')}</d:tr>`;
  const result = await imported(archive(`<d:tbl>${deletedRow}${mixedRow}${historicalRow}</d:tbl>`));
  assert.doesNotMatch(result.text!, /deleted-row|已删除姓名|姓名：手机/);
  assert.match(result.text!, /手机：13800138000\t邮箱：current@example.invalid/);
  assert.equal(result.suggested?.fullName, undefined, 'a deleted value cell must not be replaced with the next field label');
  assert.equal(result.suggested?.phone, '13800138000');
  assert.equal(result.suggested?.email, 'current@example.invalid');
  assert.equal(result.suggested?.school, '虚构大学', 'historical properties are not current deletion markers');
  assert.ok(result.evidence?.some(value => value.field === 'phone' && /第 2 行/.test(value.source)));
  assert.ok(!result.warnings?.some(value => /多个不同的/.test(value)));
});

test('hyperlink targets are displayed as inert text and mailto values retain their part-specific evidence', async () => {
  const result = await imported(archive(`<d:p><d:hyperlink r:id="email"><d:r><d:t>联系邮箱</d:t></d:r></d:hyperlink></d:p><d:p><d:hyperlink r:id="portfolio"><d:r><d:t>项目主页</d:t></d:r></d:hyperlink></d:p><d:p><d:hyperlink r:id="bad"><d:r><d:t>不支持链接</d:t></d:r></d:hyperlink></d:p>`, {
    'word/_rels/document.xml.rels': relationships(relation('email', 'hyperlink', 'mailto:link@example.invalid', true) + relation('portfolio', 'hyperlink', 'https://example.invalid/fictional-portfolio', true) + relation('bad', 'hyperlink', 'javascript:throw(1)', true)),
  }));
  assert.equal(result.suggested?.email, 'link@example.invalid');
  assert.match(result.text!, /联系邮箱 \[mailto:link@example.invalid\]/);
  assert.match(result.text!, /项目主页 \[https:\/\/example.invalid\/fictional-portfolio\]/);
  assert.doesNotMatch(result.text!, /javascript:/);
  assert.equal(result.evidence?.filter(value => value.field === 'link').length, 2);
  assert.ok(result.warnings?.some(value => /链接目标未显示/.test(value)));
});

test('duplicate equivalent emails are one candidate and educational ambiguity remains visible', async () => {
  const result = await imported(archive(`${paragraph('Fictional@Example.invalid')}${paragraph('fictional@example.invalid')}${paragraph('学历：本科')}${paragraph('学历：硕士')}${paragraph('毕业时间：2027')}`));
  assert.equal(result.suggested?.email?.toLowerCase(), 'fictional@example.invalid');
  assert.equal(result.suggested?.degree, undefined);
  assert.equal(result.suggested?.graduationMonth, undefined);
  assert.ok(!result.warnings?.some(value => /多个不同的邮箱/.test(value)));
  assert.ok(result.warnings?.some(value => /多个不同的学历/.test(value)));
  assert.ok(result.warnings?.some(value => /未推测毕业月份/.test(value)));
});

test('truncating editable resume text does not hide a conflicting contact in a referenced footer', async () => {
  const result = await imported(archive(`${paragraph('first@example.invalid')}${paragraph('x'.repeat(81_000))}<d:sectPr><d:footerReference r:id="foot"/></d:sectPr>`, {
    'word/_rels/document.xml.rels': relationships(relation('foot', 'footer', 'footer1.xml')),
    'word/footer1.xml': `<d:ftr xmlns:d="${W}">${paragraph('second@example.invalid')}</d:ftr>`,
  }));
  assert.equal(result.text!.length, 80_000);
  assert.equal(result.suggested?.email, undefined);
  assert.ok(result.warnings?.some(value => /多个不同的邮箱/.test(value)));
  assert.ok(result.warnings?.some(value => /超过 80000/.test(value)));
  assert.ok(result.evidence?.some(value => value.value === 'second@example.invalid' && /页脚/.test(value.source)));
});

test('long-paragraph evidence surrounds the actual field and positive skill mention with explicit omission markers', async () => {
  const contact = `${'背景说明'.repeat(170)} 邮箱：late@example.invalid ${'后续说明'.repeat(170)}`;
  const graduation = `${'项目前文'.repeat(170)}\t毕业时间：2027年6月\t${'后续说明'.repeat(170)}`;
  const skill = `尚未学习 PyTorch；${'经历说明'.repeat(170)}；使用 PyTorch 完成虚构训练项目。${'后续说明'.repeat(170)}`;
  const result = await imported(archive(paragraph(contact) + paragraph(graduation) + paragraph(skill)));
  assert.equal(result.suggested?.email, 'late@example.invalid');
  assert.equal(result.suggested?.graduationMonth, '2027-06');
  assert.deepEqual(result.suggested?.skills, ['PyTorch']);
  const email = result.evidence!.find(value => value.field === 'email')!;
  const date = result.evidence!.find(value => value.field === 'graduationMonth')!;
  const positive = result.evidence!.find(value => value.field === 'skills')!;
  assert.match(email.quote, /late@example.invalid/);
  assert.match(date.quote, /毕业时间：2027年6月/, 'the quote preserves the original date wording rather than the normalized candidate');
  assert.match(positive.quote, /使用 PyTorch 完成虚构训练项目/);
  assert.doesNotMatch(positive.quote, /尚未学习 PyTorch/, 'the quoted skill evidence must be the positive occurrence');
  for (const evidence of [email, date, positive]) {
    assert.match(evidence.quote, /^（前文省略）/);
    assert.match(evidence.quote, /（后文省略）$/);
    assert.ok(evidence.quote.length <= 520);
    assert.match(evidence.source, /正文 第 \d+ 段/);
  }
});

test('DOCX extraction rejects oversized selected parts, malformed XML and entity definitions, and never loads macro parts', () => {
  assert.throws(() => extractDocxText(archive(paragraph('x'.repeat(2 * 1024 * 1024)))), /过大/);
  assert.throws(() => extractDocxText(archive('<d:p><d:r><d:t>broken</d:p>')), /XML 无效/);
  assert.throws(() => extractDocxText(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE doc [<!ENTITY e SYSTEM="file:///etc/passwd">]><w:document/>') })), /实体/);
  const macro = extractDocxContent(archive(paragraph('普通文字'), { 'word/vbaProject.bin': 'not-an-executable-test-fixture' }));
  assert.equal(macro.text, '普通文字');
  assert.ok(macro.warnings.some(value => /宏不会执行/.test(value)));
  const missing = extractDocxContent(archive(`${paragraph('姓名：虚构')}<d:sectPr><d:headerReference r:id="missing"/></d:sectPr>`));
  assert.ok(missing.warnings.some(value => /页眉或页脚/.test(value)));
});
