/** Display preferences only. This module never authorizes page input or changes a native view. */
export const BROWSER_ZOOM_LEVELS = [80, 90, 100] as const;
export type BrowserZoomPercent = typeof BROWSER_ZOOM_LEVELS[number];
export interface BrowserFocusLayout {
  navigationCollapsed: boolean;
  assistantCollapsed: boolean;
  assistantPreferredWidth?: number;
}
export interface BrowserViewportState {
  mode: 'split' | 'focus';
  zoomPercent: BrowserZoomPercent;
  restoreLayout?: BrowserFocusLayout;
}
export const DEFAULT_BROWSER_VIEWPORT: BrowserViewportState = { mode: 'split', zoomPercent: 100 };

export function browserZoomPercent(value: unknown): BrowserZoomPercent {
  if (value !== 80 && value !== 90 && value !== 100) throw new TypeError('网页缩放仅支持 80%、90% 或 100%。');
  return value;
}
export function browserZoomFactor(value: unknown): number { return browserZoomPercent(value) / 100; }

/** Remember the actual two sidebars once, so exit restores the user's choices. */
export function toggleBrowserFocus(state: BrowserViewportState, layout: BrowserFocusLayout, locked = false): {
  state: BrowserViewportState; layout: BrowserFocusLayout;
} {
  if (locked) return { state, layout };
  if (state.mode === 'focus') {
    const previous = state.restoreLayout ?? layout;
    return { state: { mode: 'split', zoomPercent: state.zoomPercent }, layout: { ...previous } };
  }
  return { state: { ...state, mode: 'focus', restoreLayout: { ...layout } },
    layout: { ...layout, navigationCollapsed: true, assistantCollapsed: true } };
}

export function setBrowserViewportZoom(state: BrowserViewportState, value: unknown, locked = false): BrowserViewportState {
  if (locked) return state;
  const zoomPercent = browserZoomPercent(value);
  return zoomPercent === state.zoomPercent ? state : { ...state, zoomPercent };
}

/** Planning only: the host must actually restore 100%, revoke plans and reobserve before filling. */
export function browserViewportForFill(state: BrowserViewportState): BrowserViewportState {
  return state.zoomPercent === 100 ? state : { ...state, zoomPercent: 100 };
}

export interface BrowserWidthFit {
  zoomPercent: BrowserZoomPercent;
  fitsWidth: boolean;
  requiresHorizontalScroll: boolean;
}
/** A width-only suggestion from a measurement made at 100%; it never promises whole-page height fit. */
export function browserWidthFit(availableWidthDIP: number, contentWidthAt100CSS: number): BrowserWidthFit | undefined {
  if (![availableWidthDIP, contentWidthAt100CSS].every(value => Number.isFinite(value) && value > 0)) return;
  const zoomPercent = [...BROWSER_ZOOM_LEVELS].reverse().find(percent => contentWidthAt100CSS * percent / 100 <= availableWidthDIP) ?? 80;
  const fitsWidth = contentWidthAt100CSS * zoomPercent / 100 <= availableWidthDIP;
  return { zoomPercent, fitsWidth, requiresHorizontalScroll: !fitsWidth };
}

/** Diagnostic dimensions, not input coordinates. Retina devicePixelRatio must not be applied again. */
export function browserCSSViewport(boundsDIP: { width: number; height: number }, value: unknown): { width: number; height: number } | undefined {
  const factor = browserZoomFactor(value);
  if (![boundsDIP.width, boundsDIP.height].every(dimension => Number.isFinite(dimension) && dimension > 0)) return;
  return { width: Math.floor(boundsDIP.width / factor), height: Math.floor(boundsDIP.height / factor) };
}
