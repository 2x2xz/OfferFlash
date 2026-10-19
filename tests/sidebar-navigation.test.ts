import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../apps/desktop/renderer/Sidebar.js';

function render(collapsed: boolean, layoutLocked = false) {
  return renderToStaticMarkup(createElement(Sidebar, { page: 'browser', collapsed, layoutLocked,
    applicationCount: 3, showDemo: false, demoBusy: false,
    onToggle() {}, onNavigate() {}, onReviewProfile() {}, onDemo() {}, onExport() {}, onSettings() {} }));
}

test('compact navigation exposes the mission overview and four workflow destinations and settings with accessible names', () => {
  const html = render(true);
  for (const label of ['任务总览', '申请空间', '岗位库', '申请进度', '个人资料']) {
    assert.ok(html.includes(`aria-label="${label}" title="${label}"`), label);
  }
  assert.ok(html.includes('aria-label="展开导航"')); assert.ok(html.includes('aria-expanded="false" aria-controls="workspace-navigation"'));
  assert.equal((html.match(/data-testid="(?:nav-dashboard|apply-nav|nav-jobs|nav-applications|nav-profile)"/g) ?? []).length, 5);
  assert.ok(html.includes('aria-label="设置与工具"'));
  assert.doesNotMatch(html, /more-tools|sidebar-tip/);
  assert.match(html, /aria-label="申请空间" title="申请空间" aria-current="page"/);
});

test('active browser work disables layout changes without removing normal navigation names', () => {
  const html = render(false, true);
  const toggle = html.match(/<button[^>]*class="sidebar-toggle"[^>]*>/)?.[0];
  assert.ok(toggle); assert.ok(toggle.includes('disabled=""'));
  assert.ok(toggle.includes('aria-label="收起导航"')); assert.ok(toggle.includes('aria-expanded="true"'));
  assert.ok(toggle.includes('title="当前操作完成后可调整导航宽度"'));
});
