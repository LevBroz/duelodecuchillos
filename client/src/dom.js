// Mini helper para crear DOM sin framework.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function toast(message, type = 'info', ms = 2600) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast ${type}` }, message);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* modo privado o almacenamiento bloqueado */
    }
  },
};

export function charCount(input, max, target) {
  const update = () => (target.textContent = `${[...input.value].length}/${max}`);
  input.addEventListener('input', update);
  update();
}

// Táctil "principal": celulares y tablets. Las laptops con pantalla táctil usan mouse
// hasta que alguien toque la pantalla (ver main.js).
export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;
