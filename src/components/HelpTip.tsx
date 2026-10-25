'use client';

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { helpTipOpen, helpTipPosition, helpTipReducer, initialHelpTipState } from '../lib/help-tip';

/** Non-interactive explanatory text only; keep actions and required guidance outside. */
export default function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [state, dispatch] = useReducer(helpTipReducer, initialHelpTipState);
  const open = helpTipOpen(state);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocus = useRef(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const cancelLeave = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); leaveTimer.current = null; };
  const hover = () => { cancelLeave(); dispatch('hover'); };
  const leave = () => { cancelLeave(); leaveTimer.current = setTimeout(() => dispatch('leave'), 120); };
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!button.current || !panel.current) return;
      setPosition(helpTipPosition(button.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, panel.current.getBoundingClientRect()));
    };
    reposition(); window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open, text]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !panel.current?.contains(event.target)) dispatch('dismiss');
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dispatch('dismiss'); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <span className="il-help">
    <button ref={button} className="il-help-trigger" type="button" aria-label={`Help: ${label}`} aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined}
      onPointerEnter={event => { if (event.pointerType !== 'touch') hover(); }} onPointerLeave={leave}
      onPointerDown={() => { pointerFocus.current = true; }}
      onFocus={() => { if (!pointerFocus.current) dispatch('focus'); }}
      onBlur={() => { pointerFocus.current = false; dispatch('blur'); }}
      onClick={() => { pointerFocus.current = false; cancelLeave(); dispatch('toggle'); }}>?</button>
    {open && createPortal(<span ref={panel} id={id} role="tooltip" className="il-help-panel" style={position}
      onPointerEnter={event => { if (event.pointerType !== 'touch') hover(); }} onPointerLeave={leave}><strong>{label}</strong><span>{text}</span></span>, document.body)}
  </span>;
}
