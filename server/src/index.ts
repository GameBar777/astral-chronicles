import { config } from './config.js';
import { createGameServer } from './app.js';
const { gameServer } = createGameServer();
await gameServer.listen(config.port);
console.log(`[astral] server listening on :${config.port}`);
