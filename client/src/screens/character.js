import { h, toast, storage } from '../dom.js';
import {
  ACCESSORIES,
  CHARACTER_TYPES,
  COLORS,
  WEAPONS,
  defaultCharacter,
  findById,
} from '../../../shared/index.js';
import { CharacterPreview } from '../three/preview.js';

const TYPE_EMOJI = { human: '🧑', animal: '🦊', robot: '🤖', alien: '👽', ghost: '👻' };
const maxOf = (fn) => Math.max(...WEAPONS.map(fn));

function defaultsFor(typeId) {
  const type = findById(CHARACTER_TYPES, typeId);
  const variants = {};
  for (const g of type.variantGroups) variants[g.id] = g.options[0].id;
  return variants;
}

export function characterScreen(root, app) {
  const me = app.me();
  const char = structuredClone(me?.character || app.savedCharacter || defaultCharacter());

  const previewBox = h('div', { class: 'preview' });
  let preview = null;
  try {
    preview = new CharacterPreview(previewBox);
  } catch (err) {
    console.error(err);
    previewBox.append(h('p', { class: 'center muted', style: { padding: '24px' } }, 'Tu navegador no soporta 3D (WebGL).'));
  }

  const sections = h('div', { class: 'stack' });

  const chipGroup = (items, selected, onPick, label = (x) => x.name) =>
    h(
      'div',
      { class: 'chips', role: 'group' },
      items.map((item) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(item.id === selected),
            onclick: () => onPick(item.id),
          },
          label(item),
        ),
      ),
    );

  const statBar = (label, value) =>
    h('div', { class: 'stat' }, label, h('span', { class: 'bar' }, h('i', { style: { width: `${Math.round(value * 100)}%` } })));

  function render() {
    const type = findById(CHARACTER_TYPES, char.type);
    preview?.setCharacter(char);
    sections.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Tipo'),
        chipGroup(
          CHARACTER_TYPES,
          char.type,
          (id) => {
            if (id === char.type) return;
            char.type = id;
            char.variants = defaultsFor(id);
            render();
          },
          (t) => `${TYPE_EMOJI[t.id]} ${t.name}`,
        ),
      ),
      ...type.variantGroups.map((g) =>
        h(
          'div',
          { class: 'card' },
          h('h3', {}, g.name),
          chipGroup(
            g.options,
            char.variants[g.id],
            (id) => {
              char.variants[g.id] = id;
              render();
            },
            (o) =>
              o.hex
                ? h('span', { class: 'row' }, h('span', { class: 'dot', style: { width: '18px', height: '18px', borderRadius: '50%', background: o.hex, display: 'inline-block' } }), o.name)
                : o.name,
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Color'),
        h(
          'div',
          { class: 'swatches', role: 'group' },
          COLORS.map((c) =>
            h('button', {
              class: 'swatch',
              type: 'button',
              title: c.name,
              'aria-label': c.name,
              'aria-pressed': String(c.id === char.color),
              style: { background: c.hex },
              onclick: () => {
                char.color = c.id;
                render();
              },
            }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Accesorio'),
        chipGroup(ACCESSORIES, char.accessory, (id) => {
          char.accessory = id;
          render();
        }),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Arma'),
        h(
          'div',
          { class: 'weapons' },
          WEAPONS.map((w) =>
            h(
              'button',
              {
                class: 'weapon',
                type: 'button',
                'aria-pressed': String(w.id === char.weapon),
                onclick: () => {
                  char.weapon = w.id;
                  render();
                  preview?.swing();
                },
              },
              h('b', {}, w.name),
              h('span', { class: 'desc' }, w.description),
              statBar('Alcance', w.range / maxOf((x) => x.range)),
              statBar('Velocidad', Math.min(...WEAPONS.map((x) => x.cooldownMs)) / w.cooldownMs),
              statBar('Daño', (w.damage[0] + w.damage[1]) / maxOf((x) => x.damage[0] + x.damage[1])),
              statBar('Empuje', w.knockback / maxOf((x) => x.knockback)),
            ),
          ),
        ),
      ),
    );
  }

  const saveBtn = h('button', { class: 'btn primary big block', type: 'button' }, 'Listo, ese soy yo');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const res = await app.request('player:character', { character: char });
    saveBtn.disabled = false;
    if (!res.ok) return toast(res.error, 'error');
    app.savedCharacter = res.character;
    storage.set('duelo:character', JSON.stringify(res.character));
    const updated = app.me();
    if (updated) updated.character = res.character;
    app.nextStep();
  });

  root.append(
    h(
      'main',
      { class: 'screen wide' },
      h(
        'div',
        { class: 'topbar' },
        me?.character
          ? h('button', { class: 'btn icon ghost', 'aria-label': 'Volver', onclick: () => app.go('lobby') }, '←')
          : null,
        h('h2', {}, 'Armá tu cuchillero'),
        h('span', { class: 'pill' }, app.room?.code || ''),
      ),
      h('div', { class: 'char-layout' }, previewBox, h('div', { class: 'stack' }, sections, h('div', { class: 'sticky-bottom' }, saveBtn))),
    ),
  );
  render();

  return {
    update(room) {
      if (room.state !== 'lobby' && room.state !== 'results') toast('La pelea ya empezó sin vos...');
    },
    destroy() {
      preview?.dispose();
    },
  };
}
