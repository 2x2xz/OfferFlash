import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BROWSER_VIEWPORT, browserCSSViewport, browserViewportForFill, browserWidthFit, browserZoomFactor,
  browserZoomPercent, setBrowserViewportZoom, toggleBrowserFocus } from '../packages/ui/src/browser-viewport.js';

test('focused browsing collapses both sidebars and restores each original preference independently', () => {
  for (const navigationCollapsed of [false, true]) for (const assistantCollapsed of [false, true]) {
    const layout = { navigationCollapsed, assistantCollapsed };
    const focused = toggleBrowserFocus(DEFAULT_BROWSER_VIEWPORT, layout);
    assert.deepEqual(focused.layout, { navigationCollapsed: true, assistantCollapsed: true });
    assert.deepEqual(focused.state.restoreLayout, layout);
    const restored = toggleBrowserFocus(focused.state, focused.layout);
    assert.deepEqual(restored.layout, layout); assert.equal(restored.state.mode, 'split');
    assert.equal(restored.state.restoreLayout, undefined);
  }
});

test('focus mode snapshots are independent of later caller changes and do not mutate prior state', () => {
  const state = { ...DEFAULT_BROWSER_VIEWPORT }; const layout = { navigationCollapsed: false, assistantCollapsed: false };
  const result = toggleBrowserFocus(state, layout); layout.navigationCollapsed = true;
  assert.equal(result.state.restoreLayout!.navigationCollapsed, false); assert.equal(state.mode, 'split');
  assert.equal(state.zoomPercent, 100); assert.equal('restoreLayout' in state, false);
});

test('focus restores the original preferred dock width rather than a temporary viewport clamp or later display width', () => {
  const layout = { navigationCollapsed: false, assistantCollapsed: false, assistantPreferredWidth: 396 };
  const entered = toggleBrowserFocus(DEFAULT_BROWSER_VIEWPORT, layout);
  const restored = toggleBrowserFocus(entered.state, { navigationCollapsed: true, assistantCollapsed: true, assistantPreferredWidth: 280 });
  assert.equal(restored.layout.assistantPreferredWidth, 396);
  assert.deepEqual(restored.layout, layout); assert.equal(layout.assistantPreferredWidth, 396);
});

test('busy guards leave mode, remembered layout and zoom untouched', () => {
  const layout = { navigationCollapsed: false, assistantCollapsed: true };
  const entered = toggleBrowserFocus(DEFAULT_BROWSER_VIEWPORT, layout);
  const refused = toggleBrowserFocus(entered.state, entered.layout, true);
  assert.equal(refused.state, entered.state); assert.equal(refused.layout, entered.layout);
  assert.equal(setBrowserViewportZoom(entered.state, 80, true), entered.state);
});

test('zoom whitelist rejects hidden extra levels, strings and nonfinite inputs', () => {
  assert.equal(browserZoomFactor(80), 0.8); assert.equal(browserZoomFactor(90), 0.9); assert.equal(browserZoomFactor(100), 1);
  for (const value of [0, 70, 85, 110, '80', null, undefined, NaN, Infinity, -Infinity]) assert.throws(() => browserZoomPercent(value));
});

test('changing display zoom preserves the focus restore snapshot and never changes sidebar state', () => {
  const entered = toggleBrowserFocus(DEFAULT_BROWSER_VIEWPORT, { navigationCollapsed: false, assistantCollapsed: true });
  const zoomed = setBrowserViewportZoom(entered.state, 80);
  assert.equal(zoomed.mode, 'focus'); assert.deepEqual(zoomed.restoreLayout, entered.state.restoreLayout);
  assert.equal(entered.state.zoomPercent, 100); assert.equal(zoomed.zoomPercent, 80);
  assert.equal(setBrowserViewportZoom(zoomed, 80), zoomed);
});

test('fill preparation requests 100 percent without pretending to authorize or resume a prior plan', () => {
  const entered = toggleBrowserFocus(DEFAULT_BROWSER_VIEWPORT, { navigationCollapsed: true, assistantCollapsed: false });
  const zoomed = setBrowserViewportZoom(entered.state, 90);
  const fill = browserViewportForFill(zoomed);
  assert.equal(fill.zoomPercent, 100); assert.equal(fill.mode, 'focus'); assert.deepEqual(fill.restoreLayout, entered.state.restoreLayout);
  assert.equal(zoomed.zoomPercent, 90); assert.equal(browserViewportForFill(fill), fill);
  assert.deepEqual(Object.keys(fill).sort(), ['mode', 'restoreLayout', 'zoomPercent']);
});

test('width fit uses the largest readable preset and preserves horizontal scrolling when 80 percent is still too wide', () => {
  assert.deepEqual(browserWidthFit(1000, 1000), { zoomPercent: 100, fitsWidth: true, requiresHorizontalScroll: false });
  assert.deepEqual(browserWidthFit(900, 1000), { zoomPercent: 90, fitsWidth: true, requiresHorizontalScroll: false });
  assert.deepEqual(browserWidthFit(800, 1000), { zoomPercent: 80, fitsWidth: true, requiresHorizontalScroll: false });
  assert.deepEqual(browserWidthFit(799, 1000), { zoomPercent: 80, fitsWidth: false, requiresHorizontalScroll: true });
  assert.deepEqual(browserWidthFit(560, 1200), { zoomPercent: 80, fitsWidth: false, requiresHorizontalScroll: true });
});

test('unavailable or hidden viewport dimensions do not generate a fit recommendation', () => {
  for (const dimension of [0, -1, NaN, Infinity]) {
    assert.equal(browserWidthFit(dimension, 1000), undefined); assert.equal(browserWidthFit(1000, dimension), undefined);
  }
});

test('native display zoom changes CSS viewport dimensions independently from the host UI and screen pixel density', () => {
  assert.deepEqual(browserCSSViewport({ width: 800, height: 600 }, 80), { width: 1000, height: 750 });
  assert.deepEqual(browserCSSViewport({ width: 900, height: 630 }, 90), { width: 1000, height: 700 });
  assert.deepEqual(browserCSSViewport({ width: 800, height: 600 }, 100), { width: 800, height: 600 });
  assert.equal(browserCSSViewport({ width: 0, height: 600 }, 80), undefined);
  assert.throws(() => browserCSSViewport({ width: 800, height: 600 }, 120));
});
