// Starts Remmina on this desktop for an RDP connection.
// The password never appears on a command line (where `ps` would show it): it goes to
// `remmina --encrypt-password` on stdin, and only the encrypted form is put into the rdp:// URI.
import { spawn } from 'child_process';

function encryptPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('remmina', ['--encrypt-password'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('remmina --encrypt-password timed out'));
    }, 15_000);
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Remmina could not be started: ${error.message}`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      const match = /Encrypted password:\s*(\S+)/.exec(output);
      if (match) resolve(match[1]);
      else reject(new Error('Remmina did not return an encrypted password'));
    });
    child.stdin.end(`${password}\n`);
  });
}

export async function launchRemmina(connection: { host: string; port?: number; username?: string; password?: string }) {
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(connection.host)) throw new Error('Invalid host');
  const user = connection.username?.trim() ?? '';
  if (/[@:/\s]/.test(user)) throw new Error('Username must not contain @, :, / or spaces');

  const secret = connection.password ? `:${await encryptPassword(connection.password)}` : '';
  const port = connection.port && Number(connection.port) !== 3389 ? `:${Number(connection.port)}` : '';
  const uri = `rdp://${user ? `${user}${secret}@` : ''}${connection.host}${port}`;

  // execFile-style spawn without a shell; detached so Remmina outlives the backend
  const child = spawn('remmina', ['-c', uri], { detached: true, stdio: 'ignore', env: process.env });
  await new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Remmina could not be started: ${error.message}`)));
    child.once('spawn', () => resolve());
  });
  child.unref();
}
