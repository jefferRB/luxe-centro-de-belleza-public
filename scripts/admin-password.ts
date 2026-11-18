/** Creates (or changes) the admin password: asks for it twice without echoing it, checks
 * its strength and prints only the Argon2id hash for the server environment file.
 * The password itself is never written anywhere.
 *
 *   npm run admin:password                 → prints the lines for the server (production)
 *   npm run admin:password -- --local      → also saves them in .env.admin for `astro dev`
 */
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { argon2Available, hashPassword, passwordProblems, verifyPassword } from '../src/server/password.ts';

function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    reader.question(question, (answer) => { reader.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
    muted = hidden;
  });
}

if (!process.stdin.isTTY) {
  console.error('Ejecutá este comando en una terminal interactiva.');
  process.exit(1);
}
if (!argon2Available()) console.warn('Aviso: este Node no incluye Argon2; se usará scrypt. Recomendado: Node 24.7 o posterior.');

const username = (await ask('Usuario del panel (por ejemplo: operadora): ', false)).trim();
if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
  console.error('El usuario debe tener entre 3 y 64 letras, números, puntos, guiones o guiones bajos.');
  process.exit(1);
}
const password = await ask('Contraseña nueva: ', true);
const problems = passwordProblems(password, username);
if (problems.length) {
  console.error(`La contraseña no es segura:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
if ((await ask('Repetila: ', true)) !== password) {
  console.error('Las contraseñas no coinciden.');
  process.exit(1);
}
const hash = await hashPassword(password);
if (!(await verifyPassword(password, hash))) throw new Error('La verificación del hash falló.');

if (process.argv.includes('--local')) {
  // Git-ignored; read only by `astro dev` (src/integrations/local-admin-env.ts).
  const file = new URL('../.env.admin', import.meta.url);
  if (existsSync(file) && !/^s(i|í)?$/i.test((await ask('.env.admin ya existe. ¿Reemplazar las credenciales locales? (s/N): ', false)).trim())) {
    console.log('Sin cambios: .env.admin se conservó.');
    process.exit(0);
  }
  writeFileSync(file, `# Panel LUXE, desarrollo local (no subir al repositorio)\nLUXE_ADMIN_USER=${username}\nLUXE_ADMIN_PASSWORD_HASH='${hash}'\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log('\nGuardado en .env.admin (solo el hash). Reiniciá `npm run dev` para que el panel lo use.');
  process.exit(0);
}

console.log('\nAgregá (o reemplazá) estas líneas en el archivo de entorno del servidor (por ejemplo /etc/<app>/admin.env, permisos 600):\n');
console.log(`LUXE_ADMIN_USER=${username}`);
console.log(`LUXE_ADMIN_PASSWORD_HASH='${hash}'`);
console.log('\nDespués reiniciá el servicio (por ejemplo, systemctl restart <servicio>): las sesiones abiertas se cierran.');
