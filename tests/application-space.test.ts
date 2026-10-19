import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationDockWidth, applicationDockWidthForKey } from '../packages/ui/src/application-space.js';

test('the assistant pane preserves room for the webpage across desktop widths', () => {
  for (const available of [1016, 1216, 1416]) {
    const pane = applicationDockWidth(320, available);
    assert.ok(pane.width >= pane.min && pane.width <= pane.max);
    assert.ok(available - pane.width >= 560);
  }
  assert.equal(applicationDockWidth(Number.NaN, 1200).width, 320);
});
test('resizing the assistant pane uses clamped and accessible keyboard steps', () => {
  assert.equal(applicationDockWidthForKey('ArrowRight', 320, 1200), 332);
  assert.equal(applicationDockWidthForKey('ArrowLeft', 320, 1200, true), 280);
  assert.equal(applicationDockWidthForKey('Home', 320, 1200), 280);
  assert.equal(applicationDockWidthForKey('End', 320, 1200), 420);
  assert.equal(applicationDockWidthForKey('Tab', 320, 1200), undefined);
});
