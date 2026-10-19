import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_PANEL_HANDLE_WIDTH, DEFAULT_BROWSER_PANEL_LAYOUT, browserPanelSize, browserPanelWidthForDrag, browserPanelWidthForKey } from '../packages/ui/src/browser-panel-layout.js';

test('panel resizing leaves room for the website and never exceeds a narrow container', () => {
  for (const available of [0, 1, 11, 12, 80, 300, 500, 800, 1600]) {
    const { min, max, width } = browserPanelSize(400, available);
    assert.ok(min >= 0 && min <= width && width <= max);
    assert.ok(width <= Math.max(0, available - BROWSER_PANEL_HANDLE_WIDTH));
    if (available >= BROWSER_PANEL_HANDLE_WIDTH) {
      const website = available - width - BROWSER_PANEL_HANDLE_WIDTH;
      assert.ok(website >= Math.min(360, Math.floor((available - BROWSER_PANEL_HANDLE_WIDTH) / 2)));
    }
  }
});

test('a temporary small window does not replace the saved preferred width', () => {
  const preference = { ...DEFAULT_BROWSER_PANEL_LAYOUT, preferredWidth: 460 };
  const small = browserPanelSize(preference.preferredWidth, 500);
  assert.equal(small.width, 244);
  assert.equal(preference.preferredWidth, 460);
  assert.equal(browserPanelSize(preference.preferredWidth, 1200).width, 460);
});

test('keyboard separator controls follow right-panel direction and stop at valid limits', () => {
  assert.equal(browserPanelWidthForKey('ArrowLeft', 340, 1200), 350);
  assert.equal(browserPanelWidthForKey('ArrowRight', 340, 1200, true), 300);
  assert.equal(browserPanelWidthForKey('Home', 340, 1200), 240);
  assert.equal(browserPanelWidthForKey('End', 340, 1200), 520);
  assert.equal(browserPanelWidthForKey('ArrowLeft', 520, 1200), 520);
  assert.equal(browserPanelWidthForKey('ArrowRight', 240, 1200), 240);
  assert.equal(browserPanelWidthForKey('Enter', 340, 1200), undefined);
});

test('pointer resizing uses the initial displayed width and clamps both directions', () => {
  assert.equal(browserPanelWidthForDrag(340, 800, 750, 1200), 390);
  assert.equal(browserPanelWidthForDrag(340, 800, 1100, 1200), 240);
  assert.equal(browserPanelWidthForDrag(340, 800, 100, 1200), 520);
  assert.equal(browserPanelWidthForDrag(340, 800, 100, 500), 244);
  assert.equal(browserPanelWidthForDrag(340, Number.NaN, 100, 1200), 340);
  assert.equal(browserPanelSize(Number.NaN, 1200).width, 340);
  assert.equal(browserPanelSize(340, Number.POSITIVE_INFINITY).width, 0);
});
