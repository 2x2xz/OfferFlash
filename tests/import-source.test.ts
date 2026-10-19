import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxText, readResume } from '../packages/profile/src/import.js';
import { fetchTencentJobs } from '../packages/sources/src/catalog.js';

test('phone import preserves explicitly labelled international numbers and never guesses or truncates',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'offerflash-phone-'));
  try{
    const path=join(directory,'fictional.txt');
    for(const number of ['13800000000','+1 202-555-0100','+44 (20) 7946-0100']){
      await writeFile(path,`电话：${number}`);const result=await readResume(path);
      assert.equal(result.suggested?.phone,number);assert.ok(result.evidence?.some(e=>e.field==='phone'&&e.value===number&&e.quote.includes(number)));
    }
    for(const number of ['202-555-0100','2026-10-19','138000000001','+1234567890123456','+1 202-555-0100 ext 123','+1 )202(','+1 (20(2)) 5550100']){
      await writeFile(path,`Phone: ${number}`);const result=await readResume(path);
      assert.equal(result.suggested?.phone,undefined,number);assert.ok(result.warnings?.some(w=>w.includes('电话候选格式')));
    }
    await writeFile(path,'Phone: +1 202-555-0100\n电话：+44 20 7946 0100');
    const conflict=await readResume(path);assert.equal(conflict.suggested?.phone,undefined);assert.equal(conflict.evidence?.filter(e=>e.field==='phone').length,2);
    assert.ok(conflict.warnings?.some(w=>w.includes('多个不同')));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('DOCX extraction preserves text, XML entities and paragraph boundaries', () => {
  const archive = zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>姓名：测试同学</w:t></w:r></w:p><w:p><w:r><w:t>Python &amp; AI</w:t></w:r></w:p></w:document>') });
  assert.equal(extractDocxText(archive), '姓名：测试同学\nPython & AI');
});
test('DOCX extraction rejects a non-document archive and entity definitions', () => {
  assert.throws(() => extractDocxText(zipSync({ 'other.xml': strToU8('other') })), /正文/);
  assert.throws(() => extractDocxText(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE doc><w:t>test</w:t>') })), /实体/);
});
test('Tencent source stays experienced and does not relabel update date as publication', async () => {
  const fake: typeof fetch = async () => new Response(JSON.stringify({ Code: 200, Data: { Posts: [{ PostId: '123', RecruitPostName: '算法工程师', LocationName: '深圳', Responsibility: '研究大模型', RequireWorkYearsName: '三年以上', LastUpdateTime: '2026年09月15日' }] } }), { status: 200 });
  const jobs = await fetchTencentJobs('算法', fake);
  assert.equal(jobs[0]?.type, 'experienced');
  assert.equal(jobs[0]?.publishedAt, null);
  assert.match(jobs[0]?.description || '', /更新时间/);
  assert.equal(jobs[0]?.url, 'https://careers.tencent.com/jobdesc.html?postId=123');
});

test('resume skill suggestions require whole English words and exclude explicit negation or future learning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-skill-evidence-'));
  try {
    const path = join(directory, 'fictional.txt');
    const cases: Array<[string, string[]]> = [
      ['Storage systems; reagent analysis; NoSQL database.', []],
      ['Skills: Python / PyTorch / SQL / RAG / Agent', ['Python', 'PyTorch', 'RAG', 'Agent', 'SQL']],
      ['熟悉 Python，尚未学习 PyTorch；计划学习 TensorFlow、RAG；不熟悉 Agent。', ['Python']],
      ['Skills: Python; planning to learn PyTorch; no experience with TensorFlow; unfamiliar with RAG; Agent (not yet learned).', ['Python']],
      ['掌握机器学习；计划学习深度学习；不了解自然语言处理。', ['机器学习']],
      ['不熟悉 PyTorch 但熟悉 Python；not familiar with TensorFlow but proficient in RAG', ['Python', 'RAG']],
      ['PyTorch：尚未学习；RAG（待学习）；Agent: planned', []],
      ['过去尚未学习 PyTorch。项目经历：使用 PyTorch 完成训练。', ['PyTorch']],
      ['使用 Python 开发尚未上线的项目；项目计划已完成，熟悉 PyTorch。', ['Python', 'PyTorch']],
    ];
    for (const [text, expected] of cases) {
      await writeFile(path, text);
      const result = await readResume(path);
      assert.deepEqual(result.suggested?.skills, expected, text);
      assert.equal(result.suggested?.resumeText, text, 'extraction must keep source wording rather than rewrite it');
      assert.equal(await readFile(path, 'utf8'), text);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Generate a tiny PDF from its documented object/xref structure, with no user files or new dependency.
function fictionalResumePDF(withText = true): Buffer {
  const stream = withText ? [
    'BT /F1 12 Tf 50 780 Td',
    '(Fictional Resume Fixture) Tj',
    '0 -18 Td (Email: pdf-fixture@example.invalid) Tj',
    '0 -18 Td (Skills: Python PyTorch RAG) Tj',
    'ET',
  ].join('\n') : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test('PDF resume import extracts actual fictional text and suggestions without modifying the source', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-pdf-fixture-'));
  try {
    const path = join(directory, 'fictional-resume.pdf');
    const bytes = fictionalResumePDF();
    await writeFile(path, bytes);
    const result = await readResume(path);
    assert.equal(result.cancelled, false);
    assert.equal(result.fileName, 'fictional-resume.pdf');
    assert.match(result.text ?? '', /Fictional Resume Fixture/);
    assert.match(result.text ?? '', /pdf-fixture@example\.invalid/);
    assert.doesNotMatch(result.text ?? '', /-- \d+ of \d+ --/);
    assert.equal(result.suggested?.email, 'pdf-fixture@example.invalid');
    assert.deepEqual(result.suggested?.skills, ['Python', 'PyTorch', 'RAG']);
    assert.equal(result.suggested?.resumeText, result.text);
    assert.equal(result.suggested?.fullName, undefined, 'do not guess a name from the PDF heading');
    assert.deepEqual(await readFile(path), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('blank PDF pages are rejected instead of importing parser page counters as a resume', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offeragent-blank-pdf-fixture-'));
  try {
    const path = join(directory, 'blank.pdf');
    const bytes = fictionalResumePDF(false);
    await writeFile(path, bytes);
    await assert.rejects(readResume(path), /没有提取到文字|OCR/);
    assert.deepEqual(await readFile(path), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
