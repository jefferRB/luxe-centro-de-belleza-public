/** The admin state sent to the browser: no server paths, only what the panel shows. */
import { workCategories } from '../data/media-catalog.ts';
import { LIMITS, type MediaManifest } from '../lib/media-manifest.ts';
import { siteModel, type AdminPhoto } from './photo-model.ts';
import type { PublishStatus } from './publisher.ts';

export interface PhotoView extends Omit<AdminPhoto, 'source' | 'version'> { readonly thumb: string }

export function adminView(manifest: MediaManifest, publish: PublishStatus) {
  const model = siteModel(manifest);
  const view = (photo: AdminPhoto): PhotoView => {
    const { source: _source, version, ...rest } = photo;
    return { ...rest, thumb: `/admin/api/thumb/${encodeURIComponent(photo.id)}?v=${version}` };
  };
  return {
    revision: model.revision,
    updatedAt: manifest.updatedAt,
    sections: Object.fromEntries(Object.entries(model.sections).map(([name, photos]) => [name, photos.map(view)])),
    globe: model.globe,
    categories: Object.entries(workCategories).map(([id, label]) => ({ id, label })),
    limits: LIMITS,
    publish,
  };
}
