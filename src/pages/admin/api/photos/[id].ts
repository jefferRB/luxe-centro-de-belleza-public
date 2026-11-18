import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { adminView } from '../../../../server/admin-view.ts';
import { adminContext, handle, HttpError, json, readJson, readUpload, revisionOf } from '../../../../server/http.ts';
import { processUpload } from '../../../../server/image-intake.ts';
import { editText, replacePhoto, restorePhoto, retirePhoto } from '../../../../server/photo-model.ts';
import { isPhotoId, type MediaManifest } from '../../../../lib/media-manifest.ts';

export const prerender = false;

const photoId = (value: string | undefined) => {
  if (!isPhotoId(value)) throw new HttpError(404, 'Esa fotografía no existe.');
  return value;
};

async function respond(manifest: MediaManifest) {
  const { publisher } = adminContext();
  void publisher.request();
  return json(adminView(manifest, await publisher.describe()));
}

/** Replace the photo, keeping its id (and so its place in the globe, crown and tour). The
 * new file is stored first; the manifest switches to it only once it is safely written. */
export const POST: APIRoute = ({ params, request }) => handle(async () => {
  const { store } = adminContext();
  const id = photoId(params.id);
  const { fields, file } = await readUpload(request);
  const revision = revisionOf(fields.get('revision'));
  // A new photo usually needs a new description: both are saved in one change.
  const alt = fields.get('alt') ?? undefined;
  replacePhoto(await store.read(), id, { file: `${randomUUID()}.webp`, width: 1, height: 1 }, alt);
  const image = await store.saveUpload(await processUpload(file));
  return respond(await store.update(revision, (current) => replacePhoto(current, id, image, alt)));
});

/** Edit texts, or restore a retired photo. */
export const PATCH: APIRoute = ({ params, request }) => handle(async () => {
  const { store } = adminContext();
  const id = photoId(params.id);
  const body = await readJson(request);
  const revision = revisionOf(body.revision);
  return respond(await store.update(revision, (current) => body.restore === true
    ? restorePhoto(current, id)
    : editText(current, id, { alt: body.alt, title: body.title })));
});

/** Retire from the site (kept in the store, restorable from the panel). */
export const DELETE: APIRoute = ({ params, request }) => handle(async () => {
  const { store } = adminContext();
  const id = photoId(params.id);
  const revision = revisionOf((await readJson(request)).revision);
  return respond(await store.update(revision, (current) => retirePhoto(current, id)));
});
