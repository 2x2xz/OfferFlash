export const APPLY_LIST_BATCH_SIZE = 6;

/** Only browsing state lives here; recommendations are always recomputed from current data. */
export interface ApplyListBrowseState {
  jobIds: string[];
  visibleCount: number;
  scrollTop: number;
  anchor?: { jobId: string; offset: number };
}

export function restoreApplyListBrowse(saved: ApplyListBrowseState | undefined, jobIds: string[]): ApplyListBrowseState {
  const sameOrder = saved?.jobIds.length === jobIds.length && saved.jobIds.every((id, index) => id === jobIds[index]);
  const anchorIndex = saved?.anchor ? jobIds.indexOf(saved.anchor.jobId) : -1;
  const canRestore = !!saved && (sameOrder || anchorIndex >= 0);
  const count = canRestore ? Math.max(saved.visibleCount, anchorIndex + 1) : APPLY_LIST_BATCH_SIZE;
  return {
    jobIds: [...jobIds], visibleCount: Math.min(jobIds.length, Math.max(APPLY_LIST_BATCH_SIZE, count)),
    scrollTop: canRestore ? Math.max(0, saved.scrollTop) : 0,
    ...(canRestore && saved.anchor && anchorIndex >= 0 ? { anchor: { ...saved.anchor } } : {}),
  };
}

export function expandApplyList(browse: ApplyListBrowseState): ApplyListBrowseState {
  return { ...browse, visibleCount: Math.min(browse.jobIds.length, browse.visibleCount + APPLY_LIST_BATCH_SIZE) };
}

/** The first row intersecting the viewport survives column/height changes better than a pixel offset alone. */
export function captureApplyListBrowse(browse: ApplyListBrowseState, scrollTop: number,
  cards: Array<{ jobId: string; top: number; bottom: number }>): ApplyListBrowseState {
  const firstVisible = cards.find(card => card.bottom > 0);
  return { jobIds: [...browse.jobIds], visibleCount: browse.visibleCount, scrollTop: Math.max(0, scrollTop),
    ...(firstVisible ? { anchor: { jobId: firstVisible.jobId, offset: firstVisible.top } } : {}) };
}

export function restoredApplyListScroll(browse: ApplyListBrowseState, currentScrollTop: number, anchorTop?: number) {
  return Math.max(0, browse.anchor && anchorTop !== undefined ? currentScrollTop + anchorTop - browse.anchor.offset : browse.scrollTop);
}
