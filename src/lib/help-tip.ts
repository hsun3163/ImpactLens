/** Small UI-only state machine: hover/focus preview, click/tap pin, explicit dismissal. */
export type HelpTipState = { hovered: boolean; focused: boolean; pinned: boolean; dismissed: boolean };
export type HelpTipAction = 'hover' | 'leave' | 'focus' | 'blur' | 'toggle' | 'dismiss';
export const initialHelpTipState: HelpTipState = { hovered: false, focused: false, pinned: false, dismissed: false };
export function helpTipOpen(state: HelpTipState) { return !state.dismissed && (state.hovered || state.focused || state.pinned); }
export function helpTipReducer(state: HelpTipState, action: HelpTipAction): HelpTipState {
  switch (action) {
    case 'hover': return { ...state, hovered: true, dismissed: false };
    case 'leave': return { ...state, hovered: false };
    case 'focus': return { ...state, focused: true, dismissed: false };
    case 'blur': return { ...state, focused: false, pinned: false };
    case 'toggle': return { ...state, pinned: !state.pinned, dismissed: state.pinned };
    case 'dismiss': return { ...state, pinned: false, dismissed: true };
  }
}
export function helpTipPosition(anchor: { left: number; right: number; top: number; bottom: number }, viewport: { width: number; height: number }, size: { width: number; height: number }) {
  const margin = 12; const gap = 8;
  const left = Math.max(margin, Math.min(anchor.left + (anchor.right - anchor.left - size.width) / 2, viewport.width - size.width - margin));
  const below = anchor.bottom + gap;
  const top = Math.max(margin, Math.min(below + size.height <= viewport.height - margin ? below : anchor.top - gap - size.height, viewport.height - size.height - margin));
  return { left, top };
}
