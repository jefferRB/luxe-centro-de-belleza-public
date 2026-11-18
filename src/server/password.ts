/** Password hashing for the single admin account: Argon2id (node:crypto, Node ≥ 24.7) in
 * PHC format, with scrypt as the fallback on older runtimes. Only hashes are stored. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import * as crypto from 'node:crypto';

const ARGON2 = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 } as const;
const SCRYPT = { N: 131072, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 } as const;

type Argon2 = (algorithm: 'argon2id', parameters: { message: string | Buffer; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number }, callback: (error: Error | null, key: Buffer) => void) => void;
const argon2 = (crypto as unknown as { argon2?: Argon2 }).argon2;

const b64 = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');
const fromB64 = (text: string) => Buffer.from(text, 'base64');

function argon2id(password: string, salt: Buffer, memory: number, passes: number, parallelism: number, tagLength: number): Promise<Buffer> {
  if (!argon2) return Promise.reject(new Error('Argon2 requiere Node 24.7 o posterior.'));
  return new Promise((done, fail) => argon2('argon2id', { message: password, nonce: salt, memory, passes, parallelism, tagLength }, (error, key) => error ? fail(error) : done(key)));
}

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((done, fail) => scryptCallback(password, salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (error, key) => error ? fail(error) : done(key)));
}

export const argon2Available = () => Boolean(argon2);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  if (argon2) {
    const key = await argon2id(password, salt, ARGON2.memory, ARGON2.passes, ARGON2.parallelism, ARGON2.tagLength);
    return `$argon2id$v=19$m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}$${b64(salt)}$${b64(key)}`;
  }
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `$scrypt$n=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${b64(salt)}$${b64(key)}`;
}

const PHC = /^\$(argon2id|scrypt)\$(?:v=19\$)?([a-z]=\d+(?:,[a-z]=\d+)*)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Constant-time check; any malformed hash simply fails. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, algorithm, rawParams, rawSalt, rawKey] = match;
  const params = Object.fromEntries(rawParams!.split(',').map((pair) => { const [name, value] = pair.split('='); return [name, Number(value)]; }));
  const salt = fromB64(rawSalt!);
  const expected = fromB64(rawKey!);
  if (salt.length < 16 || expected.length < 16) return false;
  try {
    const actual = algorithm === 'argon2id'
      ? await argon2id(password, salt, params.m!, params.t!, params.p!, expected.length)
      : await scrypt(password, salt, params.n!, params.r!, params.p!, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Minimum strength for the admin password (checked by the setup script). */
export function passwordProblems(password: string, username = ''): string[] {
  const problems: string[] = [];
  if (password.length < 14) problems.push('Usá al menos 14 caracteres.');
  if (password.length > 256) problems.push('Máximo 256 caracteres.');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) problems.push('Combiná al menos tres tipos: minúsculas, mayúsculas, números o símbolos.');
  if (/(.)\1{3,}/.test(password)) problems.push('Evitá repetir el mismo carácter.');
  const lower = password.toLowerCase();
  if (['luxe', 'password', 'contrasena', 'contraseña', 'admin', '123456', 'qwerty', username.toLowerCase()].some((word) => word && lower.includes(word))) problems.push('No incluyas el usuario, «luxe», «admin» ni palabras comunes.');
  return problems;
}
