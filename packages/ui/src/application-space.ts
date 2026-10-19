/** Renderer-only layout preferences; no browser authorization or domain facts. */
export function applicationDockWidth(preferred: number, available: number): { min: number; max: number; width: number } {
  const room = Number.isFinite(available) ? Math.max(0, Math.floor(available)) : 0;
  const max = Math.max(240, Math.min(420, room - 560));
  const min = Math.min(280, max);
  return { min, max, width: Math.max(min, Math.min(max, Number.isFinite(preferred) ? Math.round(preferred) : 320)) };
}

export function applicationDockWidthForKey(key: string, current: number, available: number, large = false): number | undefined {
  const size = applicationDockWidth(current, available), step = large ? 40 : 12;
  if (key === 'Home') return size.min;
  if (key === 'End') return size.max;
  if (key === 'ArrowLeft') return applicationDockWidth(size.width - step, available).width;
  if (key === 'ArrowRight') return applicationDockWidth(size.width + step, available).width;
  return undefined;
}
