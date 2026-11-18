import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { adminView } from '../../../server/admin-view.ts';
import { adminContext, handle, json, readUpload, revisionOf } from '../../../server/http.ts';
import { processUpload } from '../../../server/image-intake.ts';
import { addPhoto } from '../../../server/photo-model.ts';

export const prerender = false;

/** Current state of every managed section. */
export const GET: APIRoute = () => handle(async () => {
  const { store, publisher } = adminContext();
  return json(adminView(await store.read(), await publisher.describe()));
});

/** A new photo for the works gallery or the interior walk. */
export const POST: APIRoute = ({ request }) => handle(async () => {
  const { store, publisher } = adminContext();
  const { fields, file } = await readUpload(request);
  const revision = revisionOf(fields.get('revision'));
  const input = {
    section: fields.get('section'),
    category: fields.get('category') ?? undefined,
    area: fields.get('area') ?? undefined,
    alt: fields.get('alt'),
    title: fields.get('title'),
  };
  const id = `subida-${randomUUID().slice(0, 13)}`;
  // Check the texts and limits before processing the file (nothing is written if they fail).
  addPhoto(await store.read(), input, { file: `${randomUUID()}.webp`, width: 1, height: 1 }, id);
  const image = await store.saveUpload(await processUpload(file));
  const manifest = await store.update(revision, (current) => addPhoto(current, input, image, id));
  void publisher.request();
  return json(adminView(manifest, await publisher.describe()), 201);
});
