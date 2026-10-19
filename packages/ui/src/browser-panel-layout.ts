/** UI-only preferences; kept by App while moving between jobs and the browser. */
export interface BrowserPanelLayout {
  collapsed: boolean;
  preferredWidth: number;
}

export const DEFAULT_BROWSER_PANEL_LAYOUT: BrowserPanelLayout = { collapsed: false, preferredWidth: 340 };
export const BROWSER_PANEL_HANDLE_WIDTH = 12;

export interface BrowserPanelSize {
  min: number;
  max: number;
  width: number;
}

/** Clamp the displayed panel, without losing the user's preferred width on a smaller window. */
export function browserPanelSize(preferredWidth: number, containerWidth: number): BrowserPanelSize {
  const available = Number.isFinite(containerWidth) ? Math.max(0, Math.floor(containerWidth)) : 0;
  // Leave at least half of a narrow window to the website. No fixed CSS min-width may overflow it.
  const websiteWidth = Math.min(360, Math.floor(Math.max(0, available - BROWSER_PANEL_HANDLE_WIDTH) / 2));
  const max = Math.max(0, Math.min(520, available - BROWSER_PANEL_HANDLE_WIDTH - websiteWidth));
  const min = Math.min(240, max);
  const desired = Number.isFinite(preferredWidth) ? Math.round(preferredWidth) : DEFAULT_BROWSER_PANEL_LAYOUT.preferredWidth;
  return { min, max, width: Math.max(min, Math.min(max, desired)) };
}

/** The right panel grows when the separator moves left; Home/End expose both limits. */
export function browserPanelWidthForKey(key: string, currentWidth: number, containerWidth: number, largeStep = false): number | undefined {
  const size = browserPanelSize(currentWidth, containerWidth);
  const step = largeStep ? 40 : 10;
  if (key === 'Home') return size.min;
  if (key === 'End') return size.max;
  if (key === 'ArrowLeft') return browserPanelSize(size.width + step, containerWidth).width;
  if (key === 'ArrowRight') return browserPanelSize(size.width - step, containerWidth).width;
  return undefined;
}

export function browserPanelWidthForDrag(startWidth: number, startX: number, currentX: number, containerWidth: number): number {
  if (![startWidth, startX, currentX].every(Number.isFinite)) return browserPanelSize(startWidth, containerWidth).width;
  return browserPanelSize(startWidth + startX - currentX, containerWidth).width;
}
