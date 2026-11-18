/** Small HTTP helpers shared by the admin API routes. */
import type { APIContext } from 'astro';
import { ManifestError } from '../lib/media-manifest.ts';
import { getAdminContext, type AdminContext } from './admin-context.ts';
import { ImageRejected, MAX_UPLOAD_BYTES } from './image-intake.ts';
import { OperationError } from './photo-model.ts';

export const SESSION_COOKIE = import.meta.env.PROD ? '__Host-luxe_admin' : 'luxe_admin';
const MAX_JSON_BYTES = 32 * 1024;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export function adminContext(): AdminContext {
  const result = getAdminContext();
  if (!result.ok) {
    console.error(`[luxe-admin] ${result.reason}`);
    throw new HttpError(503, 'El panel no está configurado en este servidor.');
  }
  return result.context;
}

/** JSON body with a size cap; requiring the JSON content type also forces a CORS preflight
 * for any cross-site attempt. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Formato de solicitud no admitido.');
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'La solicitud es demasiado grande.');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new HttpError(400, 'Solicitud inválida.');
}

/** Multipart body with the photo; rejected early when the declared size is too large. */
export async function readUpload(request: Request): Promise<{ fields: FormData; file: Uint8Array }> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Formato de solicitud no admitido.');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, 'La fotografía supera los 15 MB.');
  let fields: FormData;
  try { fields = await request.formData(); } catch { throw new HttpError(400, 'No se pudo leer la fotografía enviada.'); }
  const file = fields.get('photo');
  if (!(file instanceof File)) throw new HttpError(400, 'Elegí una fotografía.');
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'La fotografía supera los 15 MB.');
  return { fields, file: new Uint8Array(await file.arrayBuffer()) };
}

export const revisionOf = (value: unknown): number => {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) throw new HttpError(400, 'Falta la versión del panel. Recargá la página.');
  return revision;
};

/** Runs a route body and maps known failures to clear, non-leaking responses. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError || error instanceof OperationError) return json({ error: error.message }, error.status);
    if (error instanceof ImageRejected || error instanceof ManifestError) return json({ error: error.message }, 400);
    console.error('[luxe-admin] Unexpected error', error);
    return json({ error: 'Ocurrió un error inesperado. No se perdió ningún cambio anterior.' }, 500);
  }
}

export const sessionToken = (context: APIContext) => context.cookies.get(SESSION_COOKIE)?.value;
