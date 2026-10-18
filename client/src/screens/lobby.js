import { h, toast } from '../dom.js';
import { CHARACTER_TYPES, LIMITS, WEAPONS, findById, validateText } from '../../../shared/index.js';

const TYPE_EMOJI = { human: '🧑', animal: '🐾', robot: '🤖', alien: '👽', ghost: '👻' };

export function startStatus(room) {
  const players = room.players;
  if (room.state === 'results') return { ok: false, text: 'Acaba de terminar una pelea. Esperando la revancha...' };
  if (room.state === 'playing') return { ok: false, text: 'Ya se están peleando...' };
  if (room.mode === 'auto') {
    return room.options.length < 2
      ? { ok: false, text: 'Poné al menos 2 respuestas para que se agarren.' }
      : { ok: true, text: '¡Que se agarren solas!' };
  }
  if (players.length < 2) return { ok: false, text: 'Se necesitan al menos 2 cuchilleros. ¡Compartí el enlace!' };
  if (players.some((p) => !p.ready)) return { ok: false, text: 'Esperando a que todos elijan...' };
  if (new Set(players.map((p) => p.optionId)).size < 2)
    return { ok: false, text: 'Ustedes sí son de la misma opinión, hermanos. Alguien cambie de bando.' };
  return { ok: true, text: '¡Ya se armó la discusión!' };
}

export function shareMessage(room, url) {
  return `¡Te reto a un Duelo de Cuchillos! Tema: ${room.topic}. Entra aquí: ${url}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Respaldo para navegadores sin clipboard API (http en la red local).
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function lobbyScreen(root, app) {
  const shareCard = h('div', { class: 'card share-code' });
  const topicEl = h('div', { class: 'topic' });
  const groups = h('div');
  const groupsTitle = h('h3', {}, 'Los bandos');
  const countEl = h('span', { class: 'pill' });
  const hint = h('div', { class: 'start-hint' });
  const startBtn = h('button', { class: 'btn primary big block', type: 'button' }, '¡Empezar pelea!');
  const bottom = h('div', { class: 'sticky-bottom' });

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    const res = await app.request('game:start');
    if (!res.ok) {
      toast(res.error, 'error');
      render(app.room);
    }
  });

  function renderShare(room) {
    const url = app.shareUrl();
    const msg = shareMessage(room, url);
    const buttons = [
      h(
        'a',
        {
          class: 'btn wa',
          href: `https://wa.me/?text=${encodeURIComponent(msg)}`,
          target: '_blank',
          rel: 'noopener',
        },
        'Compartir por WhatsApp',
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => toast((await copyText(url)) ? '¡Enlace copiado!' : 'No se pudo copiar, copialo a mano.'),
        },
        'Copiar enlace',
      ),
    ];
    if (navigator.share) {
      buttons.push(
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => navigator.share({ title: 'Duelo de Cuchillos', text: msg, url }).catch(() => {}),
          },
          'Compartir',
        ),
      );
    }
    shareCard.replaceChildren(
      h('div', { class: 'muted small' }, 'Código de la sala'),
      h('div', { class: 'code-big' }, room.code),
      h('div', { class: 'link' }, url),
      h('div', { class: 'share-buttons' }, buttons),
    );
  }

  function playerRow(p, room) {
    const type = findById(CHARACTER_TYPES, p.character?.type);
    const weapon = findById(WEAPONS, p.character?.weapon);
    return h(
      'div',
      { class: `player-row ${p.id === app.socket.id ? 'me' : ''}` },
      h('span', { 'aria-hidden': 'true' }, type ? TYPE_EMOJI[type.id] : '❔'),
      h('span', { class: 'name' }, p.nick),
      p.id === room.hostId ? h('span', { class: 'pill host' }, 'Anfitrión') : null,
      weapon ? h('span', { class: 'pill weapon-pill' }, weapon.name) : null,
      h('span', { class: `pill ${p.ready ? 'ok' : 'wait'}` }, p.ready ? 'Listo' : 'Eligiendo...'),
    );
  }

  // ---------- Modo automático: el anfitrión pone las respuestas, todos miran ----------
  const autoInput = h('input', { type: 'text', maxlength: LIMITS.OPTION_MAX, placeholder: 'Otra respuesta', enterkeyhint: 'done' });
  const autoAdd = async (e) => {
    e.preventDefault();
    const v = validateText(autoInput.value, LIMITS.OPTION_MIN, LIMITS.OPTION_MAX);
    if (!v) return toast('La respuesta debe tener de 1 a 40 caracteres.', 'error');
    const res = await app.request('option:create', { text: v });
    if (!res.ok) return toast(res.error, 'error');
    autoInput.value = '';
  };
  const autoForm = h(
    'form',
    { class: 'row', onsubmit: autoAdd, style: { marginTop: '8px' } },
    h('div', { class: 'grow' }, autoInput),
    h('button', { class: 'btn', type: 'submit' }, '+ Agregar'),
  );

  function renderAuto(room, isHost) {
    groupsTitle.textContent = 'Los luchadores';
    const fighters = room.options.map((o) =>
      h(
        'div',
        { class: 'player-row' },
        h('span', { class: 'dot', style: { width: '14px', height: '14px', borderRadius: '50%', background: o.color, flex: '0 0 auto' } }),
        h('span', { class: 'name', style: { color: o.color } }, o.text),
        isHost
          ? h(
              'button',
              {
                class: 'btn ghost',
                style: { minHeight: '36px', padding: '2px 10px', fontSize: '13px' },
                'aria-label': `Quitar ${o.text}`,
                onclick: async () => {
                  const res = await app.request('option:remove', { optionId: o.id });
                  if (!res.ok) toast(res.error, 'error');
                },
              },
              'Quitar',
            )
          : null,
      ),
    );
    groups.replaceChildren(
      h('p', { class: 'muted small', style: { margin: '0 0 6px' } }, 'Personaje y arma al azar. Pelean solos hasta que quede uno. Cada 30 s: más rápido y con más filo.'),
      ...(fighters.length ? fighters : [h('p', { class: 'muted' }, 'Todavía no hay respuestas.')]),
      isHost && room.options.length < room.maxOptions ? autoForm : null,
      h('h4', { style: { margin: '14px 0 6px' } }, `Mirando (${room.players.length})`),
      h(
        'div',
        { class: 'spectators' },
        room.players.map((p) =>
          h('span', { class: `pill ${p.id === room.hostId ? 'host' : ''}` }, p.nick + (p.id === app.socket.id ? ' (vos)' : '')),
        ),
      ),
    );
  }

  function render(room) {
    topicEl.textContent = room.topic;
    countEl.textContent = `${room.players.length}/${room.maxPlayers}`;
    renderShare(room);

    const isHost = app.isHost();
    if (room.mode === 'auto') {
      renderAuto(room, isHost);
      const status = startStatus(room);
      hint.textContent = status.text;
      const host = room.players.find((p) => p.id === room.hostId);
      startBtn.textContent = '¡Que se peleen!';
      startBtn.disabled = !status.ok;
      bottom.replaceChildren(
        hint,
        isHost ? startBtn : h('div', { class: 'card center muted' }, `Esperando a que ${host?.nick || 'el anfitrión'} suelte a los luchadores...`),
      );
      return;
    }
    groupsTitle.textContent = 'Los bandos';
    const blocks = room.options.map((o) => {
      const members = room.players.filter((p) => p.optionId === o.id);
      const label = members.length === 1 ? '1 jugador' : `${members.length} jugadores`;
      return h(
        'div',
        { class: 'group', style: { borderColor: o.color } },
        h(
          'h4',
          {},
          h('span', { style: { color: o.color } }, `Opción: ${o.text}`),
          h('span', { class: 'pill' }, label),
          isHost && members.length === 0
            ? h(
                'button',
                {
                  class: 'btn ghost',
                  style: { minHeight: '36px', padding: '2px 10px', fontSize: '13px' },
                  onclick: async () => {
                    const res = await app.request('option:remove', { optionId: o.id });
                    if (!res.ok) toast(res.error, 'error');
                  },
                },
                'Quitar',
              )
            : null,
        ),
        members.length
          ? members.map((p) => playerRow(p, room))
          : h('div', { class: 'muted small' }, 'Nadie la defiende todavía.'),
      );
    });
    const noOption = room.players.filter((p) => !p.optionId);
    if (noOption.length) {
      blocks.push(
        h(
          'div',
          { class: 'group' },
          h('h4', {}, 'Sin opción todavía', h('span', { class: 'pill' }, String(noOption.length))),
          noOption.map((p) => playerRow(p, room)),
        ),
      );
    }
    groups.replaceChildren(...blocks);

    const status = startStatus(room);
    hint.textContent = status.text;
    const host = room.players.find((p) => p.id === room.hostId);
    bottom.replaceChildren(
      hint,
      isHost ? startBtn : h('div', { class: 'card center muted' }, `Esperando a que ${host?.nick || 'el anfitrión'} empiece la pelea...`),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn grow', type: 'button', onclick: () => app.go('character') }, 'Personaje'),
        h('button', { class: 'btn grow', type: 'button', onclick: () => app.go('option') }, 'Cambiar opción'),
      ),
    );
    startBtn.disabled = !status.ok;
  }

  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'div',
        { class: 'topbar' },
        h(
          'button',
          {
            class: 'btn icon ghost',
            'aria-label': 'Salir de la sala',
            onclick: () => confirm('¿Salir de la sala?') && app.leaveRoom(),
          },
          '←',
        ),
        h('h2', {}, 'Lobby'),
        countEl,
      ),
      h('div', { class: 'card stack' }, h('p', { class: 'muted small center', style: { margin: 0 } }, '¡Quién tiene razón!'), topicEl),
      shareCard,
      h('div', { class: 'card' }, groupsTitle, groups),
      bottom,
    ),
  );
  render(app.room);

  return { update: render };
}
