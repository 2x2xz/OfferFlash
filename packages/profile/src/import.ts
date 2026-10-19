import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, basename } from 'node:path';
import type { ProfileInput, ResumeEvidence, ResumeImport } from '../../shared/src/contracts.js';
import { extractDocxContent, type DocxContent, type ResumeBlock } from './docx.js';
import { parseCareerCandidates } from './career-import.js';
export { extractDocxText } from './docx.js';

const negativeSkillPrefix = /(?:(?:尚未|还未|未曾|未|没有)\s*(?:学习|学过|学会|掌握|熟悉|了解|使用|接触|研究|做过)|不会|不熟悉|不了解|不掌握|缺乏|(?:计划|打算|准备|拟|希望)\s*(?:开始|系统|进一步)?\s*(?:学习|学会|掌握|了解|尝试|研究|接触|使用))[^。；\n]{0,45}$|\b(?:unfamiliar|no experience|not familiar|not proficient|not experienced|(?:do not|don't|have not|haven't|never|not)\s+(?:yet\s+)?(?:know|used?|learn(?:ed)?|stud(?:y|ied)|master(?:ed)?)|plan(?:ned|ning)?\s+(?:to\s+)?(?:learn|study|use)|intend\s+to\s+(?:learn|study|use)|want\s+to\s+(?:learn|study|use))\b[^。；\n]{0,45}$/i;
const negativeSkillSuffix = /^[\s:：()（）-]*(?:(?:尚未|还未|未)\s*(?:学习|掌握|熟悉|使用)|不熟悉|不了解|待学习|计划学习|准备学习|\b(?:not\s+(?:yet\s+)?(?:learned|used|familiar|proficient)|no experience|planned|to learn)\b)/i;

function positiveSkillIndex(text: string, word: string): number | undefined {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = /^[a-z]+$/i.test(word) ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped;
  let offset = 0;
  for (const clause of text.split(/[\n。；;，,!?！？]/)) {
    for (const match of clause.matchAll(new RegExp(pattern, 'gi'))) {
      // Contrast starts a new assertion: "不熟悉 PyTorch 但熟悉 Python" can still suggest Python.
      const before = clause.slice(0, match.index).split(/但是|不过|然而|但|\b(?:but|however)\b/i).at(-1)!.slice(-70);
      const after = clause.slice(match.index + match[0].length).split(/[、。；;，,\n]/)[0]!.slice(0, 40);
      if (!negativeSkillPrefix.test(before) && !negativeSkillSuffix.test(after)) return offset + match.index;
    }
    offset += clause.length + 1;
  }
  return undefined;
}
function positiveSkillMention(text: string, word: string): boolean { return positiveSkillIndex(text, word) !== undefined; }

function quoteAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 180);
  const end = Math.min(text.length, Math.max(index + matchLength, start + 500));
  return `${start > 0 ? '（前文省略）' : ''}${text.slice(start, end)}${end < text.length ? '（后文省略）' : ''}`;
}

export async function readResume(path: string): Promise<ResumeImport> {
  const info = await stat(path);
  if (info.size > 8 * 1024 * 1024) throw new Error('简历文件超过 8 MB，请先导出较小的文本版。');
  const data = await readFile(path);
  let text: string;
  let docx: DocxContent | undefined;
  switch (extname(path).toLowerCase()) {
    case '.txt': case '.md': text = data.toString('utf8'); break;
    case '.docx': {
      docx = extractDocxContent(data);
      text = docx.text;
      break;
    }
    case '.pdf': {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(data) });
      // Default pdf-parse page counters are not resume text; blank/scanned pages must stay empty.
      try { text = (await parser.getText({ pageJoiner: '\n' })).text; } finally { await parser.destroy(); }
      break;
    }
    default: throw new Error('支持 TXT、Markdown、PDF 和 DOCX 简历。');
  }
  const warnings = [...(docx?.warnings ?? [])];
  if (text.trim().length > 80_000) warnings.push('提取文字超过 80000 字符，仅导入前段；请核对未导入的内容。');
  text = text.trim().slice(0, 80_000);
  if (!text) throw new Error('没有提取到文字。扫描版 PDF 请先做 OCR，或粘贴简历文字。');
  // Check all bounded DOCX parts for conflicts, even when the editable text preview is truncated.
  // Their individual evidence quotes remain available for review.
  const blocks: ResumeBlock[] = docx?.blocks ?? text.split(/\n/).map((line, i) => ({ text: line, source: `文本第 ${i + 1} 行` }));
  const evidence: ResumeEvidence[] = [];
  const suggested: Partial<ProfileInput> = { resumeText: text };
  const fields = [
    ['fullName', '姓名', /(?:^|\t)\s*(?:姓名|name)\s*[:：]\s*([^\n\t]{2,60})/gi],
    ['phone', '手机号', /(?:^|\t)\s*(?:手机(?:号)?|电话|phone|mobile)\s*[:：]?\s*([^\n\t]+)/gi],
    ['email', '邮箱', /(?<![A-Z0-9._%+-])([A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63})(?![A-Z0-9.-])/gi],
    ['school', '学校', /(?:^|\t)\s*(?:学校|院校|毕业院校|school|university)\s*[:：]\s*([^\n\t]{2,100})/gi],
    ['degree', '学历', /(?:^|\t)\s*(?:学历|学位|degree)\s*[:：]\s*([^\n\t]{1,60})/gi],
    ['major', '专业', /(?:^|\t)\s*(?:专业|major)\s*[:：]\s*([^\n\t]{1,100})/gi],
    ['graduationMonth', '毕业月份', /(?:^|\t)\s*(?:毕业时间|毕业年月|预计毕业时间|graduation date)\s*[:：]\s*(20\d{2}(?:[-/.年]\s*\d{1,2}\s*月?)?)/gi],
  ] as const;
  for (const [field, label, pattern] of fields) {
    const values = new Map<string, string>();
    for (const block of blocks) for (const match of block.text.matchAll(pattern)) {
      let value = match[1]!.trim();
      if (field === 'phone') {
        // Only an explicitly labelled, complete number. Never infer a country code,
        // accept a prefix of a longer number, or turn dates/extensions into a phone.
        const digits = value.replace(/\D/g, '');
        const domestic = /^1[3-9]\d{9}$/.test(value);
        const international = /^\+[1-9][\d ()-]*\d$/.test(value)
          && digits.length >= 7 && digits.length <= 15
          && value.length <= 45 && (value.match(/\(/g)?.length ?? 0) <= 1
          && !/[()]/.test(value.replace(/\(\d{1,5}\)/g, ''));
        if (!domestic && !international) {
          warnings.push('电话候选格式不明确，未推测国家区号或截取号码；请核对后填写。');
          continue;
        }
      }
      if (field === 'graduationMonth') {
        const month = /^(20\d{2})[-/.年]\s*(\d{1,2})\s*月?$/.exec(value);
        if (!month || Number(month[2]) < 1 || Number(month[2]) > 12) { warnings.push('毕业时间没有明确的有效月份，未推测毕业月份。'); continue; }
        value = `${month[1]}-${month[2]!.padStart(2, '0')}`;
      }
      values.set(field === 'email' ? value.toLowerCase() : value, value);
      evidence.push({ field, value, quote: quoteAround(block.text, match.index, match[0].length), source: block.source });
    }
    if (values.size === 1) suggested[field] = [...values.values()][0]!;
    else if (values.size > 1) warnings.push(`发现多个不同的${label}候选，未自动选取；请根据出处核对后填写。`);
  }
  const vocabulary = ['Python','PyTorch','TensorFlow','RAG','Agent','LangGraph','SQL','机器学习','深度学习','大模型','自然语言处理','强化学习','计算机视觉'];
  const skills = vocabulary.filter(word => positiveSkillMention(text, word));
  suggested.skills = skills;
  for (const skill of skills) {
    const block = blocks.find(value => positiveSkillMention(value.text, skill));
    if (block) evidence.push({ field: 'skills', value: skill, quote: quoteAround(block.text, positiveSkillIndex(block.text, skill)!, skill.length), source: block.source });
  }
  for (const link of docx?.links ?? []) evidence.push({ field: 'link', value: link.target, quote: link.label.slice(0, 500), source: link.source });
  if (evidence.length > 200) warnings.push('候选出处较多，仅显示前 200 条；请同时检查导入文字。');
  const structured = parseCareerCandidates({ text, fileName: basename(path), fileHash: createHash('sha256').update(data).digest('hex'), blocks: docx?.blocks });
  warnings.push(...structured.warnings);
  return {
    cancelled: false, fileName: basename(path), text,
    suggested, evidence: evidence.slice(0, 200), warnings: [...new Set(warnings)], career: structured.career,
  };
}
