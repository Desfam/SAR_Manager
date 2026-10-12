// Starts the Vite dev server, then the Electron window pointing at it (hot reload in the app).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

// --force: rebuild the dependency cache once per start so new packages never pull in a second React
const server = await createServer({
  server: { port: 5180, strictPort: false },
  optimizeDeps: { force: process.argv.includes('--force') },
});
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5180/';
console.log(`[dev] Vite ready at ${url}`);

const app = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, SAR_DEV_URL: url },
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
app.on('exit', shutdown);
process.on('SIGINT', () => app.kill('SIGINT'));
