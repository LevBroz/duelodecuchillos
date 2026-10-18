import './styles.css';
import { socket, request } from './net.js';
import { h, toast, storage, isTouchDevice } from './dom.js';
import { validateCharacter } from '../../shared/index.js';
import { sfx } from './audio.js';
import { homeScreen } from './screens/home.js';
import { createScreen } from './screens/create.js';
import { characterScreen } from './screens/character.js';
import { optionScreen } from './screens/option.js';
import { lobbyScreen } from './screens/lobby.js';
import { gameScreen } from './screens/game.js';
import { resultsScreen } from './screens/results.js';
import { demoScreen } from './screens/demo.js';

const root = document.getElementById('app');
if (isTouchDevice()) document.documentElement.classList.add('is-touch');
// Si alguien toca la pantalla (laptop táctil), mostrar controles táctiles; con mouse, ocultarlos.
window.addEventListener(
  'pointerdown',
  (e) => {
    document.documentElement.classList.toggle('is-touch', e.pointerType !== 'mouse');
    sfx.unlock(); // el audio solo puede arrancar con un gesto del usuario
  },
  { capture: true, passive: true },
);
window.addEventListener('keydown', () => sfx.unlock(), { capture: true, passive: true });

const screens = {
  home: homeScreen,
  create: createScreen,
  character: characterScreen,
  option: optionScreen,
  lobby: lobbyScreen,
  game: gameScreen,
  results: resultsScreen,
  demo: demoScreen,
};

function loadCharacter() {
  try {
    return validateCharacter(JSON.parse(storage.get('duelo:character', 'null')));
  } catch {
    return null;
  }
}

// Estado global de la app (no hay framework, todo cuelga de aquí).
export const app = {
  socket,
  request,
  room: null,
  match: null,
  results: null,
  nick: storage.get('duelo:nick', ''),
  savedCharacter: loadCharacter(),
  inviteCode: new URLSearchParams(location.search).get('sala')?.toUpperCase().slice(0, 5) || '',
  screenName: null,
  go,
  me() {
    return app.room?.players.find((p) => p.id === socket.id) || null;
  },
  isHost() {
    return !!app.room && app.room.hostId === socket.id;
  },
  option(id) {
    return app.room?.options.find((o) => o.id === id) || null;
  },
  shareUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('sala', app.room?.code || '');
    return url.toString();
  },
  // Siguiente paso obligatorio antes del lobby.
  nextStep() {
    const me = app.me();
    if (!me) return go('home');
    // En automático nadie elige personaje ni opción: se mira la pelea desde el lobby.
    if (app.room.mode === 'auto') return go('lobby');
    if (!me.character) return go('character');
    if (!me.optionId) return go('option');
    return go('lobby');
  },
  enterRoom(res) {
    app.room = res.room;
    app.results = null;
    app.match = null;
    const url = new URL(location.href);
    url.searchParams.set('sala', res.code);
    history.replaceState(null, '', url);
    app.nextStep();
  },
  async leaveRoom() {
    await request('room:leave');
    app.room = null;
    app.match = null;
    app.results = null;
    const url = new URL(location.href);
    url.searchParams.delete('sala');
    history.replaceState(null, '', url);
    app.inviteCode = '';
    go('home');
  },
};

let current = null;

function go(name, params) {
  if (current?.destroy) current.destroy();
  current = null;
  root.replaceChildren();
  app.screenName = name;
  window.scrollTo(0, 0);
  current = screens[name](root, app, params) || {};
}

socket.on('room:state', (state) => {
  const prev = app.room;
  app.room = state;
  // Revancha: el anfitrión volvió a abrir el lobby.
  if (state.state === 'lobby' && (app.screenName === 'game' || app.screenName === 'results')) {
    if (prev?.state !== 'lobby') toast('¡Revancha! Pueden cambiar de opción antes de empezar.');
    app.match = null;
    app.results = null;
    return app.nextStep();
  }
  current?.update?.(state);
});

socket.on('game:start', (data) => {
  app.match = data;
  app.results = null;
  go('game');
});

socket.on('game:over', (results) => {
  app.results = results;
  if (current?.onGameOver) current.onGameOver(results);
  else go('results');
});

// Indicador de conexión (Render en plan gratis puede tardar en despertar).
const badge = h('div', { class: 'conn-badge' }, 'Conectando al servidor...');
document.body.append(badge);
let everConnected = false;
const showBadge = (text) => {
  badge.textContent = text;
  badge.classList.add('show');
};
const connectTimer = setTimeout(() => !socket.connected && showBadge('Despertando el servidor...'), 1200);

socket.on('connect', () => {
  clearTimeout(connectTimer);
  badge.classList.remove('show');
  if (everConnected && app.room) {
    // El servidor nos sacó al perder la conexión: volver a entrar.
    const code = app.room.code;
    app.room = null;
    app.inviteCode = code;
    toast('Se cayó la conexión. Volvé a entrar a la sala.', 'error', 4000);
    go('home');
  }
  everConnected = true;
});
socket.on('disconnect', () => showBadge('Sin conexión, reconectando...'));
socket.on('connect_error', () => showBadge('No se puede conectar al servidor...'));

const params = new URLSearchParams(location.search);
go(params.has('demo') ? 'demo' : 'home');
