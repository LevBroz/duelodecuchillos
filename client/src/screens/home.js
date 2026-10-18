import { h, toast, storage } from '../dom.js';
import { LIMITS, validateText, ROOM_CODE_ALPHABET } from '../../../shared/index.js';

const TAGLINES = [
  '¿Quién tiene razón? ¡Que se peleen a cuchillos!',
  'Ya se armó la discusión.',
  'La ruleta es para los aguados.',
  'Aquí se resuelve todo a filo.',
];

export function homeScreen(root, app) {
  const nick = h('input', {
    type: 'text',
    maxlength: LIMITS.NICK_MAX,
    placeholder: 'Ej. Juancho',
    autocomplete: 'nickname',
    enterkeyhint: 'next',
  });
  nick.value = app.nick;

  const code = h('input', {
    type: 'text',
    class: 'code',
    maxlength: LIMITS.ROOM_CODE_LENGTH,
    placeholder: 'ABCDE',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
  });
  code.value = app.inviteCode;
  code.addEventListener('input', () => {
    const allowed = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g');
    code.value = code.value.toUpperCase().replace(allowed, '');
  });

  const validNick = () => {
    const v = validateText(nick.value, LIMITS.NICK_MIN, LIMITS.NICK_MAX);
    if (!v) {
      toast(`Tu apodo debe tener de ${LIMITS.NICK_MIN} a ${LIMITS.NICK_MAX} caracteres.`, 'error');
      nick.focus();
      return null;
    }
    app.nick = v;
    storage.set('duelo:nick', v);
    return v;
  };

  const joinBtn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar a la sala');
  const createBtn = h(
    'button',
    {
      class: `btn ${app.inviteCode ? '' : 'primary'} big block`,
      type: 'button',
      onclick: () => validNick() && app.go('create'),
    },
    'Crear sala',
  );

  const join = async (e) => {
    e?.preventDefault();
    const n = validNick();
    if (!n) return;
    if (code.value.length !== LIMITS.ROOM_CODE_LENGTH) {
      toast('El código son 5 letras.', 'error');
      code.focus();
      return;
    }
    joinBtn.disabled = true;
    const res = await app.request('room:join', { nick: n, code: code.value });
    joinBtn.disabled = false;
    if (!res.ok) return toast(res.error, 'error');
    app.enterRoom(res);
  };

  const invited = app.inviteCode
    ? h('div', { class: 'card center' }, h('b', {}, '¡Te retaron! '), `Sala ${app.inviteCode}. Poné tu apodo y entrá.`)
    : null;

  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'hero' },
        h('div', { class: 'knife', 'aria-hidden': 'true' }, '🔪'),
        h('h1', {}, 'Duelo de', h('br'), 'Cuchillos'),
        h('p', {}, TAGLINES[Math.floor(Math.random() * TAGLINES.length)]),
      ),
      invited,
      h(
        'div',
        { class: 'card stack' },
        h(
          'label',
          { class: 'field' },
          'Tu apodo',
          nick,
          h('span', { class: 'hint' }, h('span', {}, `De ${LIMITS.NICK_MIN} a ${LIMITS.NICK_MAX} caracteres`)),
        ),
        app.inviteCode ? null : createBtn,
        app.inviteCode ? null : h('div', { class: 'divider' }, 'o entrá con código'),
        h('form', { class: 'stack', onsubmit: join }, h('label', { class: 'field' }, 'Código de sala', code), joinBtn),
        app.inviteCode ? h('div', { class: 'divider' }, 'o armá la tuya') : null,
        app.inviteCode ? createBtn : null,
      ),
      h('p', { class: 'muted small center' }, 'Hasta 8 cuchilleros por sala. Sin sangre, puro relajo.'),
    ),
  );

  if (!nick.value) nick.focus();
  return {};
}
