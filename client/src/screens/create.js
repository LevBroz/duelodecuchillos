import { h, toast, charCount } from '../dom.js';
import { LIMITS, normalizeKey, validateText } from '../../../shared/index.js';

const EXAMPLES = [
  '¿Quién se robó la última tortilla?',
  '¿Pupusas de queso o revueltas?',
  '¿Quién lava los platos hoy?',
  '¿A dónde vamos a comer?',
  '¿Quién paga la cuenta?',
];

export function createScreen(root, app) {
  const topic = h('input', {
    type: 'text',
    maxlength: LIMITS.TOPIC_MAX,
    placeholder: EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)],
    enterkeyhint: 'next',
  });
  const counter = h('span');
  charCount(topic, LIMITS.TOPIC_MAX, counter);

  const initial = [];
  const optInput = h('input', {
    type: 'text',
    maxlength: LIMITS.OPTION_MAX,
    placeholder: 'Ej. Juan, La suegra, El perro',
    enterkeyhint: 'done',
  });
  const optCounter = h('span');
  charCount(optInput, LIMITS.OPTION_MAX, optCounter);
  const tags = h('div', { class: 'initial-options' });

  const renderTags = () => {
    tags.replaceChildren(
      ...initial.map((t, i) =>
        h(
          'span',
          { class: 'tag' },
          t,
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Quitar ${t}`,
              onclick: () => {
                initial.splice(i, 1);
                renderTags();
              },
            },
            '✕',
          ),
        ),
      ),
    );
    addBtn.disabled = initial.length >= LIMITS.MAX_OPTIONS;
  };

  const addOption = () => {
    const v = validateText(optInput.value, LIMITS.OPTION_MIN, LIMITS.OPTION_MAX);
    if (!v) return toast('Escribí una opción (1 a 40 caracteres).', 'error');
    if (initial.some((t) => normalizeKey(t) === normalizeKey(v))) return toast('Esa opción ya está.', 'error');
    if (initial.length >= LIMITS.MAX_OPTIONS) return toast('Máximo 8 opciones.', 'error');
    initial.push(v);
    optInput.value = '';
    optInput.dispatchEvent(new Event('input'));
    renderTags();
    optInput.focus();
  };
  optInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addOption();
    }
  });
  const addBtn = h('button', { class: 'btn', type: 'button', onclick: addOption }, '+ Agregar');

  const createBtn = h('button', { class: 'btn primary big block', type: 'submit' }, '¡Armar la sala!');

  // Modo de juego: clásico (cada quien pelea) o automático (las respuestas pelean solas)
  let mode = 'classic';
  const optTitle = h('h3', {});
  const optHint = h('p', { class: 'muted small', style: { margin: 0 } });
  const modeCards = h('div', { class: 'mode-cards', role: 'radiogroup' });
  const MODES = [
    { id: 'classic', icon: '🔪', name: 'Clásico', desc: 'Cada quien elige personaje, defiende una opción y pelea.' },
    { id: 'auto', icon: '🎲', name: 'Automático', desc: 'Vos solo ponés las respuestas y se agarran solas. Cada 30 s se pone más bravo.' },
  ];
  const renderMode = () => {
    modeCards.replaceChildren(
      ...MODES.map((m) =>
        h(
          'button',
          {
            class: 'mode-card',
            type: 'button',
            role: 'radio',
            'aria-checked': String(mode === m.id),
            onclick: () => {
              mode = m.id;
              renderMode();
            },
          },
          h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, m.icon),
          h('b', {}, m.name),
          h('span', { class: 'desc' }, m.desc),
        ),
      ),
    );
    optTitle.textContent = mode === 'auto' ? 'Las respuestas (mínimo 2)' : 'Opciones iniciales (opcional)';
    optHint.textContent =
      mode === 'auto'
        ? 'Cada respuesta será un luchador con personaje y arma al azar. Gana la que quede en pie.'
        : 'Podés dejarlo vacío y que cada quien escriba la suya.';
  };

  const submit = async (e) => {
    e.preventDefault();
    const t = validateText(topic.value, LIMITS.TOPIC_MIN, LIMITS.TOPIC_MAX);
    if (!t) {
      toast('Escribí el tema de la discusión.', 'error');
      return topic.focus();
    }
    // Si dejó algo escrito sin agregar, se agrega.
    if (optInput.value.trim()) addOption();
    if (mode === 'auto' && initial.length < 2) {
      toast('Poné al menos 2 respuestas para que se agarren.', 'error');
      return optInput.focus();
    }
    createBtn.disabled = true;
    const res = await app.request('room:create', { nick: app.nick, topic: t, options: initial, mode });
    createBtn.disabled = false;
    if (!res.ok) return toast(res.error, 'error');
    toast('Ya se armó la discusión. ¡Compartí el enlace!');
    app.enterRoom(res);
  };

  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'btn icon ghost', 'aria-label': 'Volver', onclick: () => app.go('home') }, '←'),
        h('h2', {}, 'Nueva discusión'),
      ),
      h(
        'form',
        { class: 'stack', onsubmit: submit },
        h(
          'div',
          { class: 'card stack' },
          h(
            'label',
            { class: 'field' },
            '¿Sobre qué es el pleito?',
            topic,
            h('span', { class: 'hint' }, h('span', {}, 'Vos sos el anfitrión'), counter),
          ),
        ),
        h('div', { class: 'card stack' }, h('h3', {}, 'Modo de juego'), modeCards),
        h(
          'div',
          { class: 'card stack' },
          optTitle,
          optHint,
          h('div', { class: 'row' }, h('div', { class: 'grow' }, optInput), addBtn),
          h('span', { class: 'hint muted small' }, optCounter),
          tags,
        ),
        createBtn,
      ),
    ),
  );
  renderTags();
  renderMode();
  topic.focus();
  return {};
}
