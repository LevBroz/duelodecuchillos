import { createGameServer } from './app.js';

const port = Number(process.env.PORT) || 3000;
const server = createGameServer({
  clientOrigin: process.env.CLIENT_ORIGIN, // sin definir = localhost:5173 + red local
  log: (...args) => console.error(...args),
});

server.listen(port).then((p) => {
  console.log(`Duelo de Cuchillos escuchando en el puerto ${p}`);
  const origins = server.config.clientOrigin;
  console.log(`Orígenes permitidos: ${Array.isArray(origins) ? origins.map(String).join(', ') : origins}`);
});

const shutdown = () => server.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
