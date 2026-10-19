import assert from 'node:assert/strict';
import test from 'node:test';
import { captureApplyListBrowse, expandApplyList, restoreApplyListBrowse, restoredApplyListScroll } from '../packages/ui/src/apply-list.js';

const ids = Array.from({ length: 36 }, (_, index) => `job-${index}`);

test('returning from another page restores expanded rows and the visible card instead of restarting at six', () => {
  let browse = restoreApplyListBrowse(undefined, ids);
  for (let page = 0; page < 3; page++) browse = expandApplyList(browse);
  const saved = captureApplyListBrowse(browse, 1250, [
    { jobId: 'job-10', top: -230, bottom: -10 }, { jobId: 'job-12', top: -16, bottom: 210 },
    { jobId: 'job-13', top: -16, bottom: 200 },
  ]);
  const before = structuredClone(saved);
  const restored = restoreApplyListBrowse(saved, [...ids]);
  assert.equal(restored.visibleCount, 24);
  assert.equal(restored.scrollTop, 1250);
  assert.deepEqual(restored.anchor, { jobId: 'job-12', offset: -16 });
  assert.equal(restoredApplyListScroll(restored, 0, 1234), 1250);
  assert.deepEqual(saved, before, 'restoring never changes the old snapshot or business records');
});

test('inserted or reordered recommendations retain a surviving visible card and render enough rows to reach it', () => {
  const saved = captureApplyListBrowse({ ...restoreApplyListBrowse(undefined, ids), visibleCount: 18 }, 1200,
    [{ jobId: 'job-12', top: -12, bottom: 160 }]);
  const reordered = [...ids.filter(id => id !== 'job-12'), 'job-12'];
  const restored = restoreApplyListBrowse(saved, reordered);
  assert.equal(restored.visibleCount, 36);
  assert.equal(restored.anchor?.jobId, 'job-12');
  assert.equal(restoredApplyListScroll(restored, 300, 970), 1282, 'restore relative to the card, allowing new header/card heights');
});

test('removing the visible recommendation resets safely rather than applying an unrelated old pixel position', () => {
  const saved = captureApplyListBrowse({ ...restoreApplyListBrowse(undefined, ids), visibleCount: 24 }, 2000,
    [{ jobId: 'job-12', top: -12, bottom: 160 }]);
  const restored = restoreApplyListBrowse(saved, ids.filter(id => id !== 'job-12'));
  assert.equal(restored.visibleCount, 6);
  assert.equal(restored.scrollTop, 0);
  assert.equal(restored.anchor, undefined);
});

test('empty and shortened current lists clamp browsing state and cannot resurrect removed recommendations', () => {
  const saved = { ...restoreApplyListBrowse(undefined, ids), visibleCount: 30, scrollTop: 4000 };
  assert.deepEqual(restoreApplyListBrowse(saved, []), { jobIds: [], visibleCount: 0, scrollTop: 0 });
  const short = restoreApplyListBrowse(saved, ids.slice(0, 4));
  assert.equal(short.visibleCount, 4); assert.equal(short.scrollTop, 0);
  assert.deepEqual(expandApplyList(short), short);
});

test('one append keeps all previously displayed cards and stops exactly at the current list end', () => {
  const jobIds = ids.slice(0, 14); const first = restoreApplyListBrowse(undefined, jobIds);
  const second = expandApplyList(first); const third = expandApplyList(second);
  assert.equal(first.visibleCount, 6); assert.equal(second.visibleCount, 12); assert.equal(third.visibleCount, 14);
  assert.deepEqual(second.jobIds.slice(0, first.visibleCount), first.jobIds.slice(0, first.visibleCount));
  assert.equal(expandApplyList(third).visibleCount, 14);
});

test('scroll positions stay nonnegative and pixel fallback works when a card cannot be measured', () => {
  const saved = captureApplyListBrowse(restoreApplyListBrowse(undefined, ids), -12, []);
  assert.equal(saved.scrollTop, 0); assert.equal(restoredApplyListScroll(saved, 10), 0);
  assert.equal(restoredApplyListScroll({ ...saved, scrollTop: 1200 }, 0), 1200);
});
