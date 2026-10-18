import { h, toast } from '../dom.js';

const REASONS = {
  lastStanding: 'Último en pie.',
  sameOption: 'Solo quedaron los de una misma opinión.',
  time: 'Se acabó el tiempo: ganó la opción con más vida total.',
  suddenDeath: 'Se decidió en muerte súbita.',
  draw: 'Empate total, ni la muerte súbita los separó.',
  abandon: 'Todos salieron corriendo.',
};

export function resultsScreen(root, app) {
  const res = app.results;
  if (!res) {
    app.nextStep();
    return {};
  }
  const optText = (id) => res.options.find((o) => o.optionId === id)?.text || '¿?';
  const optColor = (id) => res.options.find((o) => o.optionId === id)?.color || '#fff';

  let title;
  if (res.winners.length === 1) title = `¡${optText(res.winners[0])} tenía razón!`;
  else if (res.winners.length > 1) title = `¡Empate! ${res.winners.map(optText).join(' y ')}`;
  else title = 'Nadie tuvo la razón';

  const reasonText =
    res.reason === 'lastStanding' && res.players[0] ? `Último en pie: ${res.players[0].nick}.` : REASONS[res.reason] || '';
  const bajas = (n) => (n === 1 ? '1 baja' : `${n} bajas`);
  const isAuto = app.room?.mode === 'auto';
  const secs = Math.round(res.duration || 0);
  const autoText = isAuto
    ? `Pelearon ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} y llegaron al nivel ${res.level || 1}.`
    : '';

  // Podio: 2.º, 1.º, 3.º
  const top = res.options.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const podium = h(
    'div',
    { class: 'podium' },
    order.map((o, i) =>
      o
        ? h(
            'div',
            { class: `place p${[2, 1, 3][i]}` },
            h('span', { class: 'label', style: { color: o.color } }, o.text),
            h('span', { class: 'muted small' }, `${o.alive} en pie · ${bajas(o.kills)}`),
            h('div', { class: 'block', style: { background: o.color } }, String(o.place)),
          )
        : h('div', { class: 'place' }),
    ),
  );

  const rest = res.options.slice(3);
  const meId = app.socket.id;
  const table = h(
    'table',
    { class: 'rank-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Cuchillero'), h('th', { class: 'num' }, 'Bajas'), h('th', { class: 'num' }, 'Daño'), h('th', { class: 'num' }, 'Vida'))),
    h(
      'tbody',
      {},
      res.players.map((p) =>
        h(
          'tr',
          { style: p.id === meId ? { background: 'rgba(255,207,90,0.08)' } : {} },
          h('td', {}, p.place === 1 ? '🏆' : String(p.place)),
          h(
            'td',
            {},
            h(
              'span',
              { class: 'who' },
              h('span', { class: 'dot', style: { background: optColor(p.optionId) } }),
              h('span', {}, p.nick + (p.id === meId ? ' (vos)' : '') + (p.left ? ' 🏃' : '')),
            ),
          ),
          h('td', { class: 'num' }, String(p.kills)),
          h('td', { class: 'num' }, String(p.damage)),
          h('td', { class: 'num' }, p.alive ? String(p.hp) : '☠'),
        ),
      ),
    ),
  );

  const actions = h('div', { class: 'sticky-bottom' });
  function renderActions() {
    const isHost = app.isHost();
    const restart = h('button', { class: 'btn primary big block', type: 'button' }, '¡Revancha!');
    restart.addEventListener('click', async () => {
      restart.disabled = true;
      const r = await app.request('game:restart');
      if (!r.ok) {
        restart.disabled = false;
        toast(r.error, 'error');
      }
    });
    const msg = `En Duelo de Cuchillos discutimos "${res.topic}" y ${
      res.winners.length === 1 ? `ganó "${optText(res.winners[0])}"` : 'quedamos empatados'
    }. ¿Quién tiene razón? ${app.shareUrl()}`;
    actions.replaceChildren(
      isHost ? restart : h('div', { class: 'card center muted' }, 'Esperando a que el anfitrión pida la revancha...'),
      h(
        'div',
        { class: 'row' },
        h('a', { class: 'btn wa grow', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'Contar en WhatsApp'),
        h('button', { class: 'btn', type: 'button', onclick: () => confirm('¿Salir de la sala?') && app.leaveRoom() }, 'Salir'),
      ),
    );
  }

  root.append(
    h(
      'main',
      { class: 'screen' },
      h('p', { class: 'muted center small', style: { margin: '8px 0 0' } }, res.topic),
      h('div', { class: 'winner-title' }, title),
      h('p', { class: 'center', style: { margin: 0, fontWeight: 700 } }, reasonText),
      autoText ? h('p', { class: 'center muted', style: { margin: 0 } }, autoText) : null,
      h('div', { class: 'card' }, h('h3', {}, 'Podio por opción'), podium),
      rest.length
        ? h(
            'div',
            { class: 'card small' },
            rest.map((o) => h('div', { class: 'row', style: { padding: '4px 0' } }, h('b', {}, `${o.place}.`), h('span', { style: { color: o.color } }, o.text), h('span', { class: 'muted' }, bajas(o.kills)))),
          )
        : null,
      h('div', { class: 'card' }, h('h3', {}, isAuto ? 'Ranking de luchadores' : 'Ranking de cuchilleros'), table),
      actions,
    ),
  );
  renderActions();

  return {
    update() {
      // Puede cambiar el anfitrión mientras estamos aquí
      renderActions();
    },
  };
}
