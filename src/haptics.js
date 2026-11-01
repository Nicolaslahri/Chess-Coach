// Vibration feedback. Android browsers support navigator.vibrate. iPhones
// don't, but Safari 18+ gives a light tap when a "switch" checkbox is toggled,
// which works when it happens right after a touch.
let enabled = true;
let iosSwitch = null;

export function setHaptics(on) {
  enabled = on;
}

function iosTap() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    label.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.append(input);
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

const PATTERNS = {
  move: 12, // you or the opponent moved
  best: [15, 60, 15], // nice double tap
  inaccuracy: 40,
  mistake: [60, 70, 60],
  blunder: [120, 80, 120, 80, 120],
  offplan: [40, 60, 40],
};

export function buzz(kind) {
  if (!enabled) return;
  const pattern = PATTERNS[kind];
  if (!pattern) return;
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  } else {
    const taps = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
    for (let i = 0; i < taps; i++) setTimeout(iosTap, i * 130);
  }
}
