import { h, toast, charCount } from '../dom.js';
import { LIMITS, normalizeKey, validateText } from '../../../shared/index.js';

export function optionScreen(root, app) {
  const list = h('div', { class: 'option-list' });
  const input = h('input', {
    type: 'text',
    maxlength: LIMITS.OPTION_MAX,
    placeholder: 'Escribí tu opción',
    enterkeyhint: 'done',
  });
  const counter = h('span');
  charCount(input, LIMITS.OPTION_MAX, counter);
  const createBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Defender');
  const createCard = h('div');
  const topicEl = h('div', { class: 'topic' });

  const choose = async (optionId) => {
    const res = await app.request('option:choose', { optionId });
    if (!res.ok) return toast(res.error, 'error');
    const me = app.me();
    if (me) me.optionId = optionId;
    app.nextStep();
  };

  const create = async (e) => {
    e.preventDefault();
    const v = validateText(input.value, LIMITS.OPTION_MIN, LIMITS.OPTION_MAX);
    if (!v) return toast('Tu opción debe tener de 1 a 40 caracteres.', 'error');
    const dup = app.room.options.find((o) => normalizeKey(o.text) === normalizeKey(v));
    if (dup) {
      toast(`"${dup.text}" ya existe. Te uniste a esa.`);
      return choose(dup.id);
    }
    createBtn.disabled = true;
    const res = await app.request('option:create', { text: v });
    createBtn.disabled = false;
    if (!res.ok) return toast(res.error, 'error');
    const me = app.me();
    if (me) me.optionId = res.optionId;
    app.nextStep();
  };

  function render(room) {
    const me = app.me();
    topicEl.textContent = room.topic;
    list.replaceChildren(
      ...(room.options.length
        ? room.options.map((o) =>
            h(
              'button',
              {
                class: 'option-btn',
                type: 'button',
                'aria-pressed': String(me?.optionId === o.id),
                onclick: () => choose(o.id),
              },
              h('span', { class: 'dot', style: { background: o.color } }),
              h('span', { class: 'txt' }, o.text),
              h('span', { class: 'pill' }, o.count === 1 ? '1 la defiende' : `${o.count} la defienden`),
            ),
          )
        : [h('p', { class: 'muted center' }, 'Nadie ha propuesto nada todavía. ¡Estrenala vos!')]),
    );
    const full = room.options.length >= room.maxOptions;
    createCard.replaceChildren(
      full
        ? h('p', { class: 'muted center' }, 'Ya hay 8 opciones. Elegí una de esas.')
        : h(
            'form',
            { class: 'stack', onsubmit: create },
            h('label', { class: 'field' }, 'O creá una opción nueva', h('div', { class: 'row' }, h('div', { class: 'grow' }, input), createBtn)),
            h('span', { class: 'hint muted small' }, counter),
          ),
    );
  }

  const me = app.me();
  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'topbar' },
        me?.optionId
          ? h('button', { class: 'btn icon ghost', 'aria-label': 'Volver', onclick: () => app.go('lobby') }, '←')
          : h('button', { class: 'btn icon ghost', 'aria-label': 'Cambiar personaje', onclick: () => app.go('character') }, '←'),
        h('h2', {}, '¿Qué opinás vos?'),
        h('span', { class: 'pill' }, app.room?.code || ''),
      ),
      h('div', { class: 'card stack' }, h('p', { class: 'muted small center', style: { margin: 0 } }, 'El tema es:'), topicEl),
      h('div', { class: 'card stack' }, h('h3', {}, 'Elegí tu bando'), list),
      h('div', { class: 'card' }, createCard),
      h('p', { class: 'muted small center' }, 'Podés cambiar de opción en el lobby antes de que empiece la pelea.'),
    ),
  );
  render(app.room);

  return {
    update(room) {
      const focused = document.activeElement === input;
      const value = input.value;
      render(room);
      input.value = value;
      if (focused) input.focus();
    },
  };
}
