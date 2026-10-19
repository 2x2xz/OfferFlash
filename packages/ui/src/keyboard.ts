export interface ActivationKeyEvent {
  key: string;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
  preventDefault(): void;
}

/** Keyboard behavior for the existing focusable cards/rows, which have no native button default. */
export function activateFromKeyboard(event: ActivationKeyEvent, activate: () => void): boolean {
  if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing) return false;
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  // Holding Space must not scroll the page even though repeated activation is ignored.
  event.preventDefault();
  if (event.repeat) return false;
  activate();
  return true;
}
