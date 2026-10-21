import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UniversalDrafts } from '../apps/desktop/renderer/UniversalDrafts.js';
import type { UniversalDraft, UniversalResult } from '../packages/browser/src/universal-form.js';

const draft = (id = 'draft-one', changes: Partial<UniversalDraft> = {}): UniversalDraft => ({ id, target: 'field-1', label: '附加说明', section: '虚构项目',
  kind: 'text', sourceRefs: ['fact-fictional-one'], reason: '仅整理已提供的虚构项目说明。', needsReview: true, retained: true, value: '原创虚构草稿。\n保留第二行。', ...changes });
const result = (drafts: UniversalDraft[] = []): UniversalResult => ({ status: 'partial', verified: 2, pending: 1, drafts, draftWritten: drafts.length, pendingReview: drafts.length, message: '虚构隔离结果' });
const render = (value: UniversalResult, locked = false) => renderToStaticMarkup(createElement(UniversalDrafts, { result: value, locked }));

test('no drafts produces no review panel or controls', () => {
  assert.equal(render(result()), '');
});

test('draft review renders retained text and sources with explicit local-only marks, never as confirmed facts', () => {
  const value = result([draft()]), before = structuredClone(value), html = render(value);
  assert.match(html, /有 1 项草稿需要你核对/); assert.match(html, /原创虚构草稿。\n保留第二行。/);
  assert.match(html, /fact-fictional-one/); assert.match(html, /仅整理已提供的虚构项目说明/);
  assert.match(html, /不自动存入个人资料/); assert.match(html, /不改变核实数量或申请状态/);
  assert.match(html, /我已核对（本次标记）/); assert.doesNotMatch(html, /已确认当前修订|保存并确认|badge-green|<details[^>]*\bopen/);
  assert.doesNotMatch(html, /<input[^>]*checked/); assert.deepEqual(value, before);
});

test('selection drafts distinguish category inference, show source reason and escape untrusted text', () => {
  const html = render(result([draft('selection', { kind: 'selection', relation: 'category', value: '<script>not-executed</script>', reason: '<img src=x onerror=not-executed>', label: '<b>分类字段</b>' })]));
  assert.match(html, /按本页选项分类选择的草稿/); assert.match(html, /&lt;script&gt;not-executed&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;分类字段&lt;\/b&gt;/); assert.doesNotMatch(html, /<script>|<img|<b>分类字段/);
});

test('busy state or unknown retention disables review markers without granting page input or fact confirmation', () => {
  for (const html of [render(result([draft()]), true), render(result([draft('unretained', { retained: false })]))]) {
    assert.match(html, /<input[^>]*disabled=""/); assert.doesNotMatch(html, /<input[^>]*checked/);
  }
  assert.match(render(result([draft('unretained', { retained: false })])), /页面未核实保留，请手动检查/);
});

test('long drafts keep full original text in closed details while initial rows stay bounded', () => {
  const original = '原创虚构长文本。'.repeat(100), html = render(result([draft('long', { value: original }), ...Array.from({ length: 6 }, (_, i) => draft(`extra-${i}`))]));
  assert.equal((html.match(/data-testid="universal-draft-row"/g) ?? []).length, 5);
  assert.match(html, /显示其余 2 项草稿/); assert.ok(html.includes(original));
  assert.match(html, /查看全文、来源与整理依据/); assert.doesNotMatch(html, /<details[^>]*\bopen/);
});
