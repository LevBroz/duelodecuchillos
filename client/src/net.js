import { io } from 'socket.io-client';

// En local, si no hay VITE_SERVER_URL, se usa el mismo host en el puerto 3000.
// Así funciona también desde un celular en la misma WiFi (http://192.168.x.x:5173).
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || `${location.protocol}//${location.hostname}:3000`;

export const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 800,
  timeout: 20000,
});

export function request(event, payload = {}, timeout = 8000) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Sin conexión al servidor. Esperá un toque...' });
      return;
    }
    socket.timeout(timeout).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, error: 'El servidor no respondió. Probá otra vez.' });
      else resolve(res || { ok: false, error: 'Respuesta vacía' });
    });
  });
}
