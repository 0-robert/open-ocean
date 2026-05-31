/**
 * On-screen sailing controls for touch devices. Each button pushes the same key
 * codes the keyboard does (KeyW/A/S/D) into the shared `keys` Set that Boat.update
 * reads - so no boat-physics changes are needed. Hidden on mouse/desktop.
 *
 * @param {Set<string>} keys - the live key set from OrbitFollowControls.
 * @returns {HTMLElement|null} the controls root (or null if not a touch device).
 */
export function createTouchControls(keys) {
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!isTouch) return null;

  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none',
    zIndex: '20', userSelect: 'none', WebkitUserSelect: 'none',
  });

  const makeBtn = (label, code, style) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-label', code);
    Object.assign(b.style, {
      position: 'absolute', width: '64px', height: '64px',
      borderRadius: '50%', border: '1px solid rgba(255,255,255,0.55)',
      background: 'rgba(255,255,255,0.14)', color: '#fff',
      font: '600 26px system-ui, sans-serif', lineHeight: '60px',
      textAlign: 'center', backdropFilter: 'blur(2px)',
      pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    }, style);

    const press = (on) => (e) => {
      e.preventDefault();
      b.style.background = on ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)';
      on ? keys.add(code) : keys.delete(code);
    };
    b.addEventListener('pointerdown', press(true));
    b.addEventListener('pointerup', press(false));
    b.addEventListener('pointerleave', press(false));
    b.addEventListener('pointercancel', press(false));
    root.appendChild(b);
    return b;
  };

  // Right thumb: throttle.  Left thumb: steer.  (insets keep clear of notches)
  makeBtn('▲', 'KeyW', { right: '36px', bottom: 'calc(112px + env(safe-area-inset-bottom))' });
  makeBtn('▼', 'KeyS', { right: '36px', bottom: 'calc(36px + env(safe-area-inset-bottom))' });
  makeBtn('◀', 'KeyA', { left: '36px', bottom: 'calc(36px + env(safe-area-inset-bottom))' });
  makeBtn('▶', 'KeyD', { left: '112px', bottom: 'calc(36px + env(safe-area-inset-bottom))' });

  document.body.appendChild(root);
  return root;
}
