import { posix } from 'node:path';
import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { unzipSync } from 'fflate';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT_WORD = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STRICT_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_PART = 2 * 1024 * 1024;
const MAX_XML = 8 * 1024 * 1024;

export interface ResumeBlock { text: string; source: string; }
export interface DocxContent { text: string; blocks: ResumeBlock[]; links: Array<{ label: string; target: string; source: string }>; warnings: string[]; }
interface Relationship { target: string; type: string; external: boolean; }

function word(node: Node, name?: string): node is Element {
  return node.nodeType === 1 && [WORD, STRICT_WORD].includes((node as Element).namespaceURI ?? '') && (!name || (node as Element).localName === name);
}
function children(node: Node): Node[] { return Array.from({ length: node.childNodes.length }, (_, i) => node.childNodes.item(i)!).filter(Boolean); }
function deletedTableItem(node: Node, properties: string, marker: string): boolean {
  const current = children(node).find(child => word(child, properties));
  return current !== undefined && children(current).some(child => word(child, marker));
}
function attr(node: Element, name: string): string { return node.getAttributeNS(REL, name) || node.getAttributeNS(STRICT_REL, name) || ''; }
function xml(data: Uint8Array, part: string): Document {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DOCX 包含不支持的 XML 实体定义。');
  try {
    // The fallback namespaces also support the project's older minimal OOXML test fixtures.
    const doc = new DOMParser({ xmlns: { w: WORD, r: REL }, onError: () => { throw new Error('无效 XML'); } }).parseFromString(text, 'application/xml');
    const stack: Array<[Node, number]> = [[doc, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop()!;
      if (depth > 128) throw new Error('XML 嵌套过深');
      for (const child of children(node)) stack.push([child, depth + 1]);
    }
    return doc;
  } catch { throw new Error(`DOCX 的 ${part} XML 无效或嵌套过深。`); }
}
function relations(data: Uint8Array | undefined, part: string): Map<string, Relationship> {
  const result = new Map<string, Relationship>();
  if (!data) return result;
  const doc = xml(data, part);
  for (const element of Array.from(doc.getElementsByTagNameNS(PACKAGE_REL, 'Relationship'))) {
    const id = element.getAttribute('Id');
    if (!id || result.has(id)) throw new Error('DOCX 包含重复或缺失的关系标识。');
    result.set(id, { target: element.getAttribute('Target') ?? '', type: element.getAttribute('Type') ?? '', external: element.getAttribute('TargetMode') === 'External' });
  }
  return result;
}
function relsPath(part: string): string { return posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`); }
function internalPart(part: string, target: string): string | undefined {
  if (!target || /[\\?#\x00]/.test(target) || target.startsWith('/') || /^[a-z]+:/i.test(target)) return undefined;
  const resolved = posix.normalize(posix.join(posix.dirname(part), target));
  return resolved.startsWith('../') || !resolved.endsWith('.xml') ? undefined : resolved;
}
function displayedLink(target: string): string | undefined {
  try {
    const url = new URL(target);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? target : undefined;
  } catch { return undefined; }
}

/** Read only selected OOXML parts in memory. No archive entry is written or executed. */
export function extractDocxContent(data: Uint8Array): DocxContent {
  if (data.byteLength > MAX_XML) throw new Error('简历文件超过 8 MB，请先导出较小的文本版。');
  let total = 0;
  const warnings: string[] = [];
  const readParts = (wanted: Set<string>) => {
    let entries = 0;
    const files = unzipSync(data, { filter: file => {
      if (++entries > 2048) throw new Error('DOCX 文件条目过多。');
      if (/vbaProject\.bin$/i.test(file.name) && !warnings.some(value => value.includes('宏'))) warnings.push('文档含宏部件；仅提取文字，宏不会执行。');
      if (!wanted.has(file.name)) return false;
      total += file.originalSize;
      if (file.originalSize > MAX_PART || total > MAX_XML) throw new Error('DOCX 正文或相关文字部件过大，建议导出 TXT。');
      return true;
    } });
    return files;
  };
  const bodyPart = 'word/document.xml';
  const files = readParts(new Set([bodyPart, relsPath(bodyPart)]));
  if (!files[bodyPart]) throw new Error('不是支持的 DOCX 文档，未找到 Word 正文。');
  const body = xml(files[bodyPart], bodyPart);
  if (!body.documentElement || !word(body.documentElement, 'document')) throw new Error('不是支持的 DOCX 正文命名空间。');
  const bodyRels = relations(files[relsPath(bodyPart)], relsPath(bodyPart));
  const referenced = new Set<string>();
  const scan = (node: Node): void => {
    if (word(node, 'del') || word(node, 'moveFrom')) return;
    if (word(node) && ['headerReference', 'footerReference'].includes(node.localName ?? '')) {
      const relation = bodyRels.get(attr(node, 'id'));
      const target = relation && !relation.external && /\/(?:header|footer)$/.test(relation.type) ? internalPart(bodyPart, relation.target) : undefined;
      if (target) referenced.add(target); else warnings.push('页眉或页脚关系无法读取，相关文字未提取。');
    }
    for (const child of children(node)) scan(child);
  };
  scan(body);
  const extra = readParts(new Set([...referenced].flatMap(part => [part, relsPath(part)])));
  const blocks: ResumeBlock[] = [], links: DocxContent['links'] = [];
  const label = /^(?:姓名|手机|手机号|电话|邮箱|电子邮箱|学校|院校|学历|学位|专业|毕业时间|毕业年月|预计毕业时间|name|phone|email|school|degree|major|graduation date)\s*[:：]?$/i;

  const extractPart = (doc: Document, part: string, partRels: Map<string, Relationship>) => {
    let paragraph = 0, table = 0;
    const title = part === bodyPart ? '正文' : word(doc.documentElement!, 'hdr') ? '页眉' : '页脚';
    const source = (location: string) => `${title} ${location}（${part}）`;
    const inline = (node: Node, location: string): string => {
      if (word(node, 'del') || word(node, 'moveFrom') || word(node, 'delText')) return '';
      if (word(node, 't')) return node.textContent ?? '';
      if (word(node, 'tab')) return '\t';
      if (word(node, 'br') || word(node, 'cr')) return '\n';
      const text = children(node).map(child => inline(child, location)).join('');
      if (word(node, 'hyperlink')) {
        const relation = partRels.get(attr(node, 'id'));
        const target = relation?.external && /\/hyperlink$/.test(relation.type) ? displayedLink(relation.target) : undefined;
        if (target) { links.push({ label: text, target, source: source(location) }); return text.includes(target) ? text : `${text} [${target}]`; }
        if (relation?.external) warnings.push('有一个链接目标未显示；仅支持不含凭据的网页链接和 mailto。');
      }
      return text;
    };
    const walk = (node: Node): void => {
      if (word(node, 'del') || word(node, 'moveFrom')) return;
      if (word(node, 'p')) {
        const location = `第 ${++paragraph} 段`;
        const text = inline(node, location).trim();
        if (text) blocks.push({ text, source: source(location) });
      } else if (word(node, 'tbl')) {
        const tableId = ++table;
        let rowId = 0;
        const rows = children(node).filter(child => word(child, 'tr'));
        for (const row of rows) {
          const location = `表格 ${tableId} 第 ${++rowId} 行`;
          if (deletedTableItem(row, 'trPr', 'del')) continue;
          // Keep a missing slot for a deleted cell so its neighbouring labels cannot acquire the wrong value.
          const cells = children(row).filter(child => word(child, 'tc')).map(cell => deletedTableItem(cell, 'tcPr', 'cellDel')
            ? undefined
            : children(cell).filter(child => word(child, 'p') || word(child, 'tbl')).map(child => inline(child, location)).join(' / ').trim());
          const pieces: string[] = [];
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell === undefined) continue;
            const next = cells[i + 1];
            if (label.test(cell) && next !== undefined && !label.test(next)) {
              pieces.push(`${cell.replace(/[:：]\s*$/, '')}：${next}`);
              i++;
            } else pieces.push(cell);
          }
          const text = pieces.join('\t').trim();
          if (text) blocks.push({ text, source: source(location) });
        }
      } else for (const child of children(node)) walk(child);
    };
    walk(doc);
  };
  extractPart(body, bodyPart, bodyRels);
  for (const part of referenced) {
    if (!extra[part]) { warnings.push('文档引用的页眉或页脚缺失，相关文字未提取。'); continue; }
    const doc = xml(extra[part], part);
    if (!doc.documentElement || (!word(doc.documentElement, 'hdr') && !word(doc.documentElement, 'ftr'))) throw new Error('DOCX 页眉或页脚部件无效。');
    extractPart(doc, part, relations(extra[relsPath(part)], relsPath(part)));
  }
  return { text: blocks.map(block => block.text).join('\n'), blocks, links, warnings: [...new Set(warnings)] };
}

export function extractDocxText(data: Uint8Array): string { return extractDocxContent(data).text; }
