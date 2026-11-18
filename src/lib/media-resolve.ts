/** Applies the admin manifest to the curated catalog. Pure and generic over the image type,
 * so the build (Astro ImageMetadata), the admin (file paths) and the tests share it.
 * Ids never change: a replaced photo keeps its id, so the globe, the crown and the space
 * tour keep their positions, data attributes and behaviour. */
import type { MediaRecord } from '../data/media-catalog.ts';
import type { ServiceGroup } from '../data/services.ts';
import type { SpaceStop } from '../data/spaces.ts';
import type { MediaManifest, UploadRef } from './media-manifest.ts';

export interface ManagedFields<I> {
  readonly image: I;
  readonly thumb?: I;
  /** The catalog photo now shows an upload (its tuned framing no longer applies). */
  readonly replaced: boolean;
  /** Created from the admin (not part of the curated catalog). */
  readonly managed: boolean;
  /** Showcase copy for uploaded works (catalog works use portfolioCopy). */
  readonly copy?: { readonly title: string; readonly description: string };
}
export type ResolvedMedia<I> = MediaRecord & ManagedFields<I>;

const UPLOADED_EVIDENCE = 'Publicada desde el panel administrativo de LUXE';

/** Listed ids first, in list order; the rest keep their relative order after them. */
export function orderBy<T>(items: readonly T[], idOf: (item: T) => string, list: readonly string[] | undefined): T[] {
  if (!list?.length) return [...items];
  const rank = new Map(list.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(idOf(item)) ?? list.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}

const sentence = (title: string) => /[.!?…]$/.test(title) ? title : `${title}.`;

export function applyManifest<I>(
  base: readonly (MediaRecord & { readonly image: I; readonly thumb?: I })[],
  manifest: MediaManifest,
  imageFor: (ref: UploadRef) => I | undefined,
): ResolvedMedia<I>[] {
  const image = (ref: UploadRef, id: string): I => {
    const found = imageFor(ref);
    // A missing upload must stop the build: the previous release stays online.
    if (found === undefined) throw new Error(`Managed image missing for ${id}: ${ref.file}`);
    return found;
  };
  const curated = base.flatMap((item): ResolvedMedia<I>[] => {
    const edit = manifest.edits[item.id];
    if (edit?.removed) return [];
    if (!edit) return [{ ...item, replaced: false, managed: false }];
    const replacement = edit.replacement;
    return [{
      ...item,
      alt: edit.alt ?? item.alt,
      image: replacement ? image(replacement, item.id) : item.image,
      thumb: replacement ? undefined : item.thumb,
      objectPosition: replacement ? undefined : item.objectPosition,
      replaced: Boolean(replacement),
      managed: false,
    }];
  });
  const lastOrder = Math.max(0, ...base.map((item) => item.order));
  const uploaded = manifest.added.flatMap((item, index): ResolvedMedia<I>[] => {
    const edit = manifest.edits[item.id];
    if (edit?.removed) return [];
    const alt = edit?.alt ?? item.alt;
    const title = edit?.title ?? item.title;
    const ref = edit?.replacement ?? item.image;
    return [{
      id: item.id,
      source: `uploads/${ref.file}`,
      category: item.section === 'trabajos' ? item.category : 'espacio',
      kind: item.section === 'trabajos' ? 'result' : 'interior',
      alt,
      caption: title,
      order: lastOrder + 1 + index,
      permission: { status: 'approved', evidence: UPLOADED_EVIDENCE, reviewedAt: item.createdAt },
      image: image(ref, item.id),
      replaced: Boolean(edit?.replacement),
      managed: true,
      ...(item.section === 'trabajos' && { copy: { title: sentence(title), description: alt } }),
    }];
  });
  // Works follow the admin order when there is one; everything else keeps the catalog order.
  const all = [...curated, ...uploaded].sort((a, b) => a.order - b.order);
  if (!manifest.order.trabajos?.length) return all;
  const isWork = (item: ResolvedMedia<I>) => item.category !== 'espacio' && item.category !== 'promocional';
  const works = orderBy(all.filter(isWork), (item) => item.id, manifest.order.trabajos);
  const rank = new Map(works.map((item, index) => [item.id, index + 1]));
  return all
    .map((item) => rank.has(item.id) ? { ...item, order: rank.get(item.id)! } : { ...item, order: works.length + item.order })
    .sort((a, b) => a.order - b.order);
}

/** The interior walk: catalog stops plus uploaded spaces, minus retired ones, in admin order. */
export function resolveSpaceStops(stops: readonly SpaceStop[], manifest: MediaManifest): SpaceStop[] {
  const curated = stops.filter((stop) => !manifest.edits[stop.mediaId]?.removed);
  const uploaded = manifest.added.flatMap((item): SpaceStop[] => item.section === 'espacio' && !manifest.edits[item.id]?.removed
    ? [{ mediaId: item.id, area: item.area, title: manifest.edits[item.id]?.title ?? item.title, description: manifest.edits[item.id]?.alt ?? item.alt }]
    : []);
  return orderBy([...curated, ...uploaded], (stop) => stop.mediaId, manifest.order.espacio);
}

/** Specialties with the admin's Mundo LUXE selection. A tuned framing is dropped once its
 * photo is replaced; buildGlobe still skips ids that are no longer published. */
export function resolveServiceGroups(groups: readonly ServiceGroup[], manifest: MediaManifest): ServiceGroup[] {
  return groups.map((group) => {
    const globe = manifest.globe[group.id] ?? group.globe;
    const replaced = Boolean(group.mediaId && manifest.edits[group.mediaId]?.replacement);
    const { focus, ...rest } = group;
    return { ...rest, ...(globe && { globe }), ...(!replaced && focus && { focus }) };
  });
}

/** The hero photo: the reception unless the admin replaced it. */
export function resolveSingle<I>(id: string, fallback: { readonly image: I; readonly alt: string }, manifest: MediaManifest, imageFor: (ref: UploadRef) => I | undefined) {
  const edit = manifest.edits[id];
  const image = edit?.replacement ? imageFor(edit.replacement) : fallback.image;
  if (image === undefined) throw new Error(`Managed image missing for ${id}`);
  return { image, alt: edit?.alt ?? fallback.alt, replaced: Boolean(edit?.replacement) };
}
