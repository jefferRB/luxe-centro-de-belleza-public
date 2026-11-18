/** What the admin manages, section by section, and the rules for each change. Pure: the
 * manifest goes in, a new manifest (or a readable refusal) comes out. Sections mirror the
 * real page: hero, works (showcase + Mundo LUXE), the interior walk and the facade. */
import { canUseMedia, isPublishable, mediaCatalog, receptionPhoto, workCategories, isWork, type WorkCategory } from '../data/media-catalog.ts';
import { portfolioCopy } from '../data/portfolio.ts';
import { services } from '../data/services.ts';
import { spaceTour } from '../data/spaces.ts';
import { cleanText, currentUpload, FACADE_ID, HERO_ID, LIMITS, parseManifest, type AddedPhoto, type ManagedSection, type MediaManifest, type PhotoEdit, type UploadRef } from '../lib/media-manifest.ts';
import { orderBy } from '../lib/media-resolve.ts';

export class OperationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type PhotoSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'upload'; readonly file: string };

export interface AdminPhoto {
  readonly id: string;
  readonly section: ManagedSection;
  readonly origin: 'catalogo' | 'subida';
  readonly alt: string;
  readonly title: string;
  readonly category?: WorkCategory;
  readonly area?: string;
  readonly removed: boolean;
  readonly replaced: boolean;
  readonly source: PhotoSource;
  /** Short version key for cache-busting thumbnails. */
  readonly version: string;
  /** Title editable (uploaded photos only; catalog copy is curated). */
  readonly editableTitle: boolean;
}

export interface GlobeSelection {
  readonly id: string;
  readonly name: string;
  readonly category: WorkCategory;
  readonly ids: readonly string[];
  /** No explicit selection left: the globe picks the first works of the category. */
  readonly automatic: boolean;
}

export interface SiteModel {
  readonly revision: number;
  readonly sections: Readonly<Record<ManagedSection, readonly AdminPhoto[]>>;
  readonly globe: readonly GlobeSelection[];
}

interface BasePhoto { id: string; section: ManagedSection; alt: string; title: string; category?: WorkCategory; area?: string; path: string }

/** The curated photos the public build shows, by section (production selection). */
function catalogPhotos(): BasePhoto[] {
  const published = mediaCatalog.filter((item) => canUseMedia(item, false));
  const hero: BasePhoto[] = isPublishable(receptionPhoto.permission) ? [{ id: HERO_ID, section: 'portada', alt: receptionPhoto.alt, title: 'Recepción', path: receptionPhoto.source }] : [];
  const works = published.filter(isWork).map((item): BasePhoto => ({
    id: item.id, section: 'trabajos', alt: item.alt, title: portfolioCopy[item.id]?.title.replace(/\.$/, '') ?? item.caption, category: item.category, path: item.source,
  }));
  const stops = spaceTour.flatMap((stop): BasePhoto[] => {
    const item = published.find((photo) => photo.id === stop.mediaId);
    return item ? [{ id: item.id, section: 'espacio', alt: item.alt, title: stop.title, area: stop.area, path: item.source }] : [];
  });
  const facade = published.filter((item) => item.id === FACADE_ID).map((item): BasePhoto => ({ id: item.id, section: 'fachada', alt: item.alt, title: item.caption, path: item.source }));
  return [...hero, ...works, ...stops, ...facade];
}

function toAdmin(base: BasePhoto | AddedPhoto, manifest: MediaManifest): AdminPhoto {
  const added = 'createdAt' in base;
  const edit: PhotoEdit = manifest.edits[base.id] ?? {};
  const upload = currentUpload(manifest, base.id);
  const source: PhotoSource = upload ? { kind: 'upload', file: upload.file } : { kind: 'file', path: (base as BasePhoto).path };
  return {
    id: base.id,
    section: base.section,
    origin: added ? 'subida' : 'catalogo',
    alt: edit.alt ?? base.alt,
    title: edit.title ?? base.title,
    ...('category' in base && base.category && { category: base.category }),
    ...('area' in base && base.area && { area: base.area }),
    removed: Boolean(edit.removed),
    replaced: Boolean(edit.replacement),
    source,
    version: upload ? upload.file.slice(0, 8) : 'original',
    editableTitle: added,
  };
}

export function siteModel(manifest: MediaManifest): SiteModel {
  const all = [...catalogPhotos(), ...manifest.added].map((photo) => toAdmin(photo, manifest));
  const section = (name: ManagedSection) => all.filter((photo) => photo.section === name);
  const ordered = (name: 'trabajos' | 'espacio') => {
    const photos = section(name);
    const active = orderBy(photos.filter((photo) => !photo.removed), (photo) => photo.id, manifest.order[name]);
    return [...active, ...photos.filter((photo) => photo.removed)];
  };
  const trabajos = ordered('trabajos');
  const activeWorks = trabajos.filter((photo) => !photo.removed);
  const globe = services.map((group): GlobeSelection => {
    const own = activeWorks.filter((photo) => photo.category === group.category);
    const chosen = (manifest.globe[group.id] ?? group.globe ?? []).filter((id) => own.some((photo) => photo.id === id));
    // Same fallback as buildGlobe: the representative first, then the category's works.
    const fallback = [...own.filter((photo) => photo.id === group.mediaId), ...own.filter((photo) => photo.id !== group.mediaId)].slice(0, LIMITS.globePerSpecialty);
    return { id: group.id, name: group.name, category: group.category, ids: chosen.length ? chosen : fallback.map((photo) => photo.id), automatic: !chosen.length };
  });
  return {
    revision: manifest.revision,
    sections: { portada: section('portada'), trabajos, espacio: ordered('espacio'), fachada: section('fachada') },
    globe,
  };
}

// ——— Changes ———

function findPhoto(model: SiteModel, id: string): AdminPhoto {
  const photo = Object.values(model.sections).flat().find((candidate) => candidate.id === id);
  if (!photo) throw new OperationError('Esa fotografía no existe.', 404);
  return photo;
}

function commit(manifest: MediaManifest, changes: Partial<Omit<MediaManifest, 'version' | 'revision' | 'updatedAt'>>, now: Date): MediaManifest {
  // Re-validate the whole result with the same parser the build uses.
  return parseManifest(JSON.parse(JSON.stringify({ ...manifest, ...changes, revision: manifest.revision + 1, updatedAt: now.toISOString() })));
}

const withEdit = (manifest: MediaManifest, id: string, edit: PhotoEdit) => ({ ...manifest.edits, [id]: { ...manifest.edits[id], ...edit } });
const without = <T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> => { const { [key]: _removed, ...rest } = value; return rest; };

export interface NewPhotoInput {
  /** 'trabajos' or 'espacio'; anything else is refused. */
  readonly section: unknown;
  readonly category?: unknown;
  readonly area?: unknown;
  readonly alt: unknown;
  readonly title: unknown;
}

export function addPhoto(manifest: MediaManifest, input: NewPhotoInput, image: UploadRef, id: string, now = new Date()): MediaManifest {
  const model = siteModel(manifest);
  const alt = cleanText(input.alt, 'alt', 'Texto alternativo');
  const title = cleanText(input.title, 'title', 'Título');
  const createdAt = now.toISOString();
  let added: AddedPhoto;
  if (input.section === 'trabajos') {
    if (typeof input.category !== 'string' || !Object.hasOwn(workCategories, input.category)) throw new OperationError('Elegí una especialidad.');
    if (model.sections.trabajos.filter((photo) => !photo.removed).length >= LIMITS.works.max) throw new OperationError(`La galería admite hasta ${LIMITS.works.max} trabajos. Retirá alguno antes de subir otro.`);
    added = { id, section: 'trabajos', category: input.category as WorkCategory, image, alt, title, createdAt };
  } else if (input.section === 'espacio') {
    if (model.sections.espacio.filter((photo) => !photo.removed).length >= LIMITS.spaceStops.max) throw new OperationError(`El recorrido admite hasta ${LIMITS.spaceStops.max} ambientes.`);
    added = { id, section: 'espacio', area: cleanText(input.area, 'area', 'Ambiente'), image, alt, title, createdAt };
  } else {
    throw new OperationError('En esta sección solo se puede reemplazar la fotografía.');
  }
  const section = added.section;
  // New photos join the end of their section's current order.
  const order = manifest.order[section] ? { ...manifest.order, [section]: [...manifest.order[section]!, id] } : manifest.order;
  return commit(manifest, { added: [...manifest.added, added], order }, now);
}

/** A new image for the same id; a new description can be saved with it in one change. */
export function replacePhoto(manifest: MediaManifest, id: string, image: UploadRef, alt?: unknown, now = new Date()): MediaManifest {
  const photo = findPhoto(siteModel(manifest), id);
  if (photo.removed) throw new OperationError('Restaurá la fotografía antes de reemplazarla.');
  const description = typeof alt === 'string' && alt.trim() ? { alt: cleanText(alt, 'alt', 'Texto alternativo') } : {};
  return commit(manifest, { edits: withEdit(manifest, id, { replacement: image, ...description }) }, now);
}

export function editText(manifest: MediaManifest, id: string, input: { alt?: unknown; title?: unknown }, now = new Date()): MediaManifest {
  const photo = findPhoto(siteModel(manifest), id);
  const edit: PhotoEdit = {
    ...(input.alt !== undefined && { alt: cleanText(input.alt, 'alt', 'Texto alternativo') }),
    ...(input.title !== undefined && photo.editableTitle && { title: cleanText(input.title, 'title', 'Título') }),
  };
  if (!Object.keys(edit).length) throw new OperationError('No hay cambios para guardar.');
  return commit(manifest, { edits: withEdit(manifest, id, edit) }, now);
}

export function retirePhoto(manifest: MediaManifest, id: string, now = new Date()): MediaManifest {
  const model = siteModel(manifest);
  const photo = findPhoto(model, id);
  if (photo.removed) throw new OperationError('La fotografía ya estaba retirada.', 409);
  const active = (section: ManagedSection) => model.sections[section].filter((item) => !item.removed).length;
  if (photo.section === 'portada' || photo.section === 'fachada') throw new OperationError('Esta fotografía es parte del diseño: podés reemplazarla, pero no retirarla.');
  if (photo.section === 'trabajos' && active('trabajos') <= LIMITS.works.min) throw new OperationError('La galería necesita al menos un trabajo.');
  if (photo.section === 'espacio' && active('espacio') <= LIMITS.spaceStops.min) throw new OperationError(`El recorrido 3D necesita al menos ${LIMITS.spaceStops.min} ambientes.`);
  const globe = Object.fromEntries(Object.entries(manifest.globe).map(([specialty, ids]) => [specialty, ids.filter((item) => item !== id)]));
  return commit(manifest, { edits: withEdit(manifest, id, { removed: true }), globe }, now);
}

export function restorePhoto(manifest: MediaManifest, id: string, now = new Date()): MediaManifest {
  const model = siteModel(manifest);
  const photo = findPhoto(model, id);
  if (!photo.removed) throw new OperationError('La fotografía ya está publicada.', 409);
  if (photo.section === 'espacio' && model.sections.espacio.filter((item) => !item.removed).length >= LIMITS.spaceStops.max) throw new OperationError(`El recorrido admite hasta ${LIMITS.spaceStops.max} ambientes.`);
  if (photo.section === 'trabajos' && model.sections.trabajos.filter((item) => !item.removed).length >= LIMITS.works.max) throw new OperationError(`La galería admite hasta ${LIMITS.works.max} trabajos.`);
  const edit = without(manifest.edits[id] ?? {}, 'removed');
  const edits = Object.keys(edit).length ? { ...manifest.edits, [id]: edit } : without(manifest.edits, id);
  return commit(manifest, { edits }, now);
}

/** New order for a section: exactly its published photos, each once. */
export function setOrder(manifest: MediaManifest, section: unknown, ids: unknown, now = new Date()): MediaManifest {
  if (section !== 'trabajos' && section !== 'espacio') throw new OperationError('Esta sección no se puede ordenar.');
  const active = siteModel(manifest).sections[section].filter((photo) => !photo.removed).map((photo) => photo.id);
  if (!Array.isArray(ids) || ids.length !== active.length || new Set(ids).size !== ids.length || !ids.every((id) => active.includes(id))) {
    throw new OperationError('El orden no coincide con las fotografías publicadas. Recargá el panel.', 409);
  }
  return commit(manifest, { order: { ...manifest.order, [section]: ids as string[] } }, now);
}

/** Mundo LUXE: the works shown for one specialty, in order (the first leads on the equator). */
export function setGlobe(manifest: MediaManifest, specialtyId: unknown, ids: unknown, now = new Date()): MediaManifest {
  const group = services.find((candidate) => candidate.id === specialtyId);
  if (!group) throw new OperationError('Especialidad desconocida.', 404);
  const works = siteModel(manifest).sections.trabajos.filter((photo) => !photo.removed && photo.category === group.category).map((photo) => photo.id);
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || !ids.every((id) => works.includes(id))) throw new OperationError('Solo se pueden elegir trabajos publicados de esta especialidad.');
  if (ids.length > LIMITS.globePerSpecialty) throw new OperationError(`El Mundo LUXE muestra hasta ${LIMITS.globePerSpecialty} fotografías por especialidad.`);
  return commit(manifest, { globe: { ...manifest.globe, [group.id]: ids as string[] } }, now);
}
