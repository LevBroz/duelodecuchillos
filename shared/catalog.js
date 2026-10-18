// Catálogos compartidos entre cliente y servidor.
// El servidor solo acepta IDs que existan aquí.

export const CHARACTER_TYPES = [
  {
    id: 'human',
    name: 'Humano',
    variantGroups: [
      {
        id: 'skin',
        name: 'Tono de piel',
        options: [
          { id: 'skin1', name: 'Claro', hex: '#f6d3b3' },
          { id: 'skin2', name: 'Trigueño', hex: '#e0ac7e' },
          { id: 'skin3', name: 'Moreno', hex: '#b9784a' },
          { id: 'skin4', name: 'Canela', hex: '#8d5a35' },
          { id: 'skin5', name: 'Oscuro', hex: '#5c3920' },
        ],
      },
      {
        id: 'hair',
        name: 'Peinado',
        options: [
          { id: 'short', name: 'Corto' },
          { id: 'long', name: 'Largo' },
          { id: 'mohawk', name: 'Cresta' },
          { id: 'bun', name: 'Moño' },
          { id: 'bald', name: 'Pelón' },
        ],
      },
    ],
  },
  {
    id: 'animal',
    name: 'Animal humanoide',
    variantGroups: [
      {
        id: 'species',
        name: 'Animal',
        options: [
          { id: 'fox', name: 'Zorro' },
          { id: 'bear', name: 'Oso' },
          { id: 'rabbit', name: 'Conejo' },
          { id: 'wolf', name: 'Lobo' },
          { id: 'cat', name: 'Gato' },
          { id: 'owl', name: 'Búho' },
        ],
      },
    ],
  },
  {
    id: 'robot',
    name: 'Robot',
    variantGroups: [
      {
        id: 'head',
        name: 'Cabeza',
        options: [
          { id: 'antenna', name: 'Antena cuadrada' },
          { id: 'leds', name: 'Dos ojos LED' },
          { id: 'visor', name: 'Visor' },
        ],
      },
    ],
  },
  {
    id: 'alien',
    name: 'Alien',
    variantGroups: [
      {
        id: 'form',
        name: 'Forma',
        options: [
          { id: 'threeEyes', name: 'Tres ojos' },
          { id: 'snail', name: 'Antenas de caracol' },
          { id: 'longHead', name: 'Cabeza alargada' },
        ],
      },
    ],
  },
  {
    id: 'ghost',
    name: 'Fantasma',
    variantGroups: [
      {
        id: 'style',
        name: 'Estilo',
        options: [
          { id: 'sheet', name: 'Sábana con ojos' },
          { id: 'hood', name: 'Capucha con luz' },
        ],
      },
    ],
  },
];

export const COLORS = [
  { id: 'red', name: 'Rojo', hex: '#e63946' },
  { id: 'orange', name: 'Naranja', hex: '#f4a261' },
  { id: 'yellow', name: 'Amarillo', hex: '#f6c90e' },
  { id: 'green', name: 'Verde', hex: '#2a9d8f' },
  { id: 'blue', name: 'Azul', hex: '#3a86ff' },
  { id: 'purple', name: 'Morado', hex: '#8e44ad' },
  { id: 'pink', name: 'Rosado', hex: '#ff70a6' },
  { id: 'white', name: 'Blanco', hex: '#f1f1f1' },
];

export const ACCESSORIES = [
  { id: 'none', name: 'Ninguno' },
  { id: 'hat', name: 'Sombrero' },
  { id: 'glasses', name: 'Gafas' },
  { id: 'scarf', name: 'Bufanda' },
  { id: 'crown', name: 'Corona' },
];

// range: alcance en unidades del ring (radio del ring = RING_RADIUS)
// cooldownMs: tiempo entre ataques
// damage: [min, max] con variación aleatoria
// arc: ángulo total del golpe en radianes
// knockback: empuje en unidades
export const WEAPONS = [
  {
    id: 'knife',
    name: 'Cuchillo',
    hit: 'cuchillazo',
    range: 1.6,
    arc: Math.PI * 0.6,
    cooldownMs: 450,
    damage: [8, 12],
    knockback: 0.9,
    description: 'Equilibrado, el de la cocina.',
  },
  {
    id: 'dagger',
    name: 'Daga',
    hit: 'dagazo',
    range: 1.3,
    arc: Math.PI * 0.5,
    cooldownMs: 300,
    damage: [5, 9],
    knockback: 0.6,
    description: 'Cortita pero rapidísima.',
  },
  {
    id: 'switchblade',
    name: 'Navaja',
    hit: 'navajazo',
    range: 1.45,
    arc: Math.PI * 0.55,
    cooldownMs: 380,
    damage: [7, 11],
    knockback: 1.2,
    description: 'Empuja más de lo que parece.',
  },
  {
    id: 'shortsword',
    name: 'Espada corta',
    hit: 'espadazo',
    range: 2.1,
    arc: Math.PI * 0.7,
    cooldownMs: 700,
    damage: [12, 18],
    knockback: 1.6,
    description: 'Lenta, pero llega lejos.',
  },
];

export const findById = (list, id) => list.find((x) => x.id === id) || null;

export function defaultCharacter() {
  return {
    type: 'human',
    variants: { skin: 'skin2', hair: 'short' },
    color: 'blue',
    accessory: 'none',
    weapon: 'knife',
  };
}

// Personaje al azar (modo automático). `rng` devuelve un número en [0, 1).
export function randomCharacter(rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length) % list.length];
  const type = pick(CHARACTER_TYPES);
  const variants = {};
  for (const g of type.variantGroups) variants[g.id] = pick(g.options).id;
  return {
    type: type.id,
    variants,
    color: pick(COLORS).id,
    accessory: pick(ACCESSORIES).id,
    weapon: pick(WEAPONS).id,
  };
}

// Devuelve un personaje normalizado o null si algo no existe en el catálogo.
export function validateCharacter(input) {
  if (!input || typeof input !== 'object') return null;
  const type = findById(CHARACTER_TYPES, input.type);
  if (!type) return null;
  if (!findById(COLORS, input.color)) return null;
  if (!findById(ACCESSORIES, input.accessory)) return null;
  if (!findById(WEAPONS, input.weapon)) return null;
  const variantsIn = input.variants && typeof input.variants === 'object' ? input.variants : null;
  if (!variantsIn) return null;
  const variants = {};
  for (const group of type.variantGroups) {
    const v = variantsIn[group.id];
    if (!findById(group.options, v)) return null;
    variants[group.id] = v;
  }
  // Claves extra no permitidas
  for (const k of Object.keys(variantsIn)) {
    if (!type.variantGroups.some((g) => g.id === k)) return null;
  }
  return {
    type: type.id,
    variants,
    color: input.color,
    accessory: input.accessory,
    weapon: input.weapon,
  };
}
