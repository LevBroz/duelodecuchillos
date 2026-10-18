// Utilidades de texto usadas por cliente y servidor.

// Caracteres de control C0/C1, de ancho cero y de dirección bidi.
function isControl(cp) {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff
  );
}

function stripControl(value) {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    // Tab y saltos de línea se vuelven espacio; el resto desaparece.
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out += ' ';
    else if (!isControl(cp)) out += ch;
  }
  return out;
}

// Quita caracteres de control y colapsa espacios.
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return stripControl(value.normalize('NFC')).replace(/\s+/g, ' ').trim();
}

// Clave para comparar opciones: ignora mayúsculas, acentos y espacios extra.
export function normalizeKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

// Valida longitud (en caracteres visibles). Devuelve el texto limpio o null.
export function validateText(value, min, max) {
  const t = cleanText(value);
  const len = [...t].length;
  if (len < min || len > max) return null;
  return t;
}
