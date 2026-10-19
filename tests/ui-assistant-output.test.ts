import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantOutput } from '../apps/desktop/renderer/AssistantOutput.js';
import { outputLink } from '../packages/ui/src/output-link.js';

test('assistant output formats lists, emphasis, tables and code while leaving navigation to a user action', () => {
  let opened = false;
  const text = '**匹配理由**\n\n- 已确认 Python\n- 毕业届数待核对\n\n| 岗位 | 状态 |\n|---|---|\n| 测试研发 | 待核对 |\n\n[岗位官网](https://example.invalid/job)\n\n```text\n不表示已经投递\n```';
  const html = renderToStaticMarkup(createElement(AssistantOutput, { text, onOpenLink: () => { opened = true; } }));
  assert.ok(html.includes('<strong>匹配理由</strong>'));
  assert.ok(html.includes('<ul>') && html.includes('<table>') && html.includes('<pre>'));
  assert.ok(html.includes('data-output-url="https://example.invalid/job"'));
  assert.equal(opened, false);
});

test('generated HTML, remote images and dangerous or credential-bearing links cannot create executable or loading elements', () => {
  const text = '<script>alert(1)</script>\n\n<iframe src="https://example.invalid/embed"></iframe>\n\n![remote picture](https://example.invalid/track.png)\n\n[script](javascript:alert%281%29) [local](file:///tmp/secret) [credential](https://user:pass@example.invalid)';
  const html = renderToStaticMarkup(createElement(AssistantOutput, { text, onOpenLink: () => assert.fail('Rendering must not navigate') }));
  assert.ok(!/<(?:script|iframe|img)\b/i.test(html));
  assert.ok(!html.includes('data-output-url='));
  assert.ok(html.includes('图片说明：remote picture'));
});

test('only HTTP(S) links and local document anchors are available; fragments never change the application URL', () => {
  assert.deepEqual(outputLink('https://example.invalid/job'), { kind: 'external', url: 'https://example.invalid/job', host: 'example.invalid' });
  assert.deepEqual(outputLink('#user-content-fn-1'), { kind: 'fragment', id: 'user-content-fn-1' });
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/html,x', 'mailto:a@example.invalid', '//example.invalid', 'https://a:b@example.invalid', '#bad id', '/local-file']) assert.equal(outputLink(url), undefined);
  const html = renderToStaticMarkup(createElement(AssistantOutput, { text: '[注释](#user-content-fn-1)', onOpenLink: () => assert.fail() }));
  assert.ok(!html.includes('href='));
});

test('Chinese footnotes keep literal generated fragment IDs and links retain their visible accessible names', () => {
  const html = renderToStaticMarkup(createElement(AssistantOutput, { text: '示例[^注1]\n\n[^注1]: 注释\n\n[岗位列表](https://example.invalid/list) [申请详情](https://example.invalid/detail)', onOpenLink: () => assert.fail() }));
  assert.ok(html.includes('id="user-content-fn-%E6%B3%A81"'));
  assert.ok(html.includes('id="user-content-fnref-%E6%B3%A81"'));
  assert.ok(html.includes('class="assistant-link">1</button>'));
  assert.ok(!html.includes('aria-label="在内置浏览器打开'));
  assert.ok(!html.includes('href='));
});
