import type { APIRoute } from 'astro';
import { adminView } from '../../../server/admin-view.ts';
import { adminContext, handle, json, readJson, revisionOf } from '../../../server/http.ts';
import { setGlobe, setOrder } from '../../../server/photo-model.ts';

export const prerender = false;

/** New order for the works gallery or the interior walk, or a specialty's Mundo LUXE photos. */
export const PUT: APIRoute = ({ request }) => handle(async () => {
  const { store, publisher } = adminContext();
  const body = await readJson(request);
  const revision = revisionOf(body.revision);
  const manifest = await store.update(revision, (current) => body.section === 'globe'
    ? setGlobe(current, body.specialty, body.ids)
    : setOrder(current, body.section, body.ids));
  void publisher.request();
  return json(adminView(manifest, await publisher.describe()));
});
