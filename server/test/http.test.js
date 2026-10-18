import { afterEach, describe, expect, it } from 'vitest';
import { parseOrigins } from '../src/app.js';
import { startServer } from './helpers.js';

let ctx;
afterEach(async () => {
  await ctx?.stop();
  ctx = null;
});

describe('HTTP y CORS', () => {
  it('responde /health', async () => {
    ctx = await startServer();
    const res = await fetch(`${ctx.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('solo permite el origen configurado en CLIENT_ORIGIN', async () => {
    ctx = await startServer({ clientOrigin: 'https://duelo.netlify.app' });
    const ok = await fetch(`${ctx.url}/health`, { headers: { Origin: 'https://duelo.netlify.app' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://duelo.netlify.app');
    const bad = await fetch(`${ctx.url}/health`, { headers: { Origin: 'https://malo.example.com' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    // Handshake de Socket.IO (polling) con origen no permitido → rechazado
    const sio = await fetch(`${ctx.url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: 'https://malo.example.com' } });
    expect(sio.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rechaza conexiones WebSocket desde un origen no permitido', async () => {
    ctx = await startServer({ clientOrigin: 'https://duelo.netlify.app' });
    const { io } = await import('socket.io-client');
    const tryConnect = (origin) =>
      new Promise((resolve) => {
        const s = io(ctx.url, { transports: ['websocket'], extraHeaders: { Origin: origin }, reconnection: false, forceNew: true });
        s.once('connect', () => {
          s.disconnect();
          resolve('ok');
        });
        s.once('connect_error', () => {
          s.disconnect();
          resolve('error');
        });
      });
    expect(await tryConnect('https://malo.example.com')).toBe('error');
    expect(await tryConnect('https://duelo.netlify.app')).toBe('ok');
  });

  it('parseOrigins: lista, comodines y valores por defecto de desarrollo', () => {
    expect(parseOrigins('https://a.com, https://b.com/')).toEqual(['https://a.com', 'https://b.com']);
    const [re] = parseOrigins('https://*--duelo.netlify.app');
    expect(re.test('https://deploy-preview-3--duelo.netlify.app')).toBe(true);
    expect(re.test('https://evil.com/--duelo.netlify.app')).toBe(false);
    const dev = parseOrigins(undefined);
    expect(dev).toContain('http://localhost:5173');
    const lan = dev.find((o) => o instanceof RegExp);
    expect(lan.test('http://192.168.1.50:5173')).toBe(true);
    expect(lan.test('http://8.8.8.8:5173')).toBe(false);
  });
});
