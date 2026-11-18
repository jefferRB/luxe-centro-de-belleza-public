import type { ImageMetadata } from 'astro';
import { angularDistance, fibonacciSphere, nearestFree, orientationFacing, shadeFor, facingDepth, spreadByTag, type Orientation, type SpherePoint } from '../lib/sphere.ts';
import type { ServiceGroup } from './services.ts';
import { spaceTour, type SpaceStop } from './spaces.ts';

/** El Mundo LUXE: one sphere of real photos and clips — works, interiors and moments of
 * care — laid out as a deliberate mix. The featured clip starts in front; each specialty's
 * representative photo sits on the equator so choosing it is one short turn; every other
 * piece is spread so that wherever the visitor turns, neighbours differ (never a wall of a
 * single category). A specialty without publishable photos is represented by one emerald
 * LUXE emblem carrying its name, never by a photo of something else. Remaining points
 * become decorative facets: no photo or clip is ever repeated. */

type AvailablePhoto = {
  readonly id: string;
  readonly category: string;
  readonly image: ImageMetadata;
  /** Lighter variant for the small panels; the full image stays for the lightbox. */
  readonly thumb?: ImageMetadata;
  readonly alt: string;
  readonly caption: string;
  readonly order?: number;
  readonly objectPosition?: `${number}% ${number}%`;
};
type AvailableVideo = {
  readonly id: string;
  readonly category: string;
  readonly src: string;
  readonly posterImage: ImageMetadata;
  readonly title: string;
  readonly alt: string;
  readonly caption: string;
  readonly featured: boolean;
  readonly objectPosition: `${number}% ${number}%`;
};

export type GlobePanelKind = 'photo' | 'video' | 'emblem' | 'facet';
export interface GlobePanel {
  readonly key: string;
  readonly kind: GlobePanelKind;
  readonly point: SpherePoint;
  /** Relative panel size (1 = standard). */
  readonly size: number;
  /** Specialty this panel represents; interiors, the welcome clip and facets have none. */
  readonly specialtyId?: string;
  /** What the panel shows (the light variant when there is one; a clip's poster). */
  readonly image?: ImageMetadata;
  /** What the lightbox opens: always the full image (a clip's poster for videos). */
  readonly zoomImage?: ImageMetadata;
  /** Muted loop URL, for video panels only. */
  readonly video?: string;
  readonly alt?: string;
  readonly caption: string;
  /** Short name revealed with the gold trace when the piece comes to the front. */
  readonly label: string;
  readonly focus: `${number}% ${number}%`;
  /** The first piece in front: the welcome clip. */
  readonly hero: boolean;
  /** Static depth shading for the initial orientation (no-JS rendering). */
  readonly shade: number;
  /** Decorative facets that small screens may drop. */
  readonly filler: boolean;
}
export interface GlobeSpecialty {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly description: string;
  readonly message: string;
  readonly category: ServiceGroup['category'];
  readonly works: boolean;
  /** Key of the panel brought to the front when the specialty is chosen. */
  readonly featured: string;
}
export interface GlobeLayout {
  readonly panels: readonly GlobePanel[];
  readonly specialties: readonly GlobeSpecialty[];
  readonly initial: Orientation;
  /** Key of the welcome clip in front, when there is one. */
  readonly hero?: string;
}

const MIN_PANELS = 26;
const MIN_FACETS = 6;
/** Works per specialty when its curated list is absent: a mix, not the whole archive. */
const PER_SPECIALTY = 4;
/** Seven equatorial slots (≈51° apart): the welcome clip in front, the five specialties
 * around it and the second clip behind, to be found again by turning. */
const RING = 360 / 7;
const RING_LATS = [0, 10, -12, 9, -10, 12, -8] as const;
const SPECIALTY_SLOTS = [1, 2, 3, 5, 6] as const;
const BACK_SLOT = 4;
/** Hierarchy: the welcome clip leads, then the other clip, then the representatives. */
const HERO_SIZE = 1.36;
const VIDEO_SIZE = 1.16;
const FEATURED_SIZE = 1.06;
const SIZES = [.96, .9, 1, .92, .98] as const;
/** Pieces right beside the welcome clip stay smaller, so it is never covered. */
const HERO_CLEARANCE = 42;
const NEIGHBOUR_SIZE = .84;

export const pendingPhotosNote = (name: string) => `Pronto compartiremos fotografías de ${name.toLocaleLowerCase('es-CR')}.`;

const ringPoint = (slot: number): SpherePoint => ({ lat: RING_LATS[slot % RING_LATS.length]!, lon: Math.round(((slot * RING + 180) % 360) - 180) });

type Content = Omit<GlobePanel, 'point' | 'size' | 'shade' | 'filler' | 'hero'> & { readonly tag: string };

export function buildGlobe(groups: readonly ServiceGroup[], photos: readonly AvailablePhoto[], videos: readonly AvailableVideo[] = [], stops: readonly SpaceStop[] = spaceTour): GlobeLayout {
  const specialtyItems = groups.map((group): Content[] => {
    const own = photos.filter((photo) => photo.category === group.category);
    const curated = group.globe?.flatMap((id) => own.filter((photo) => photo.id === id)) ?? [];
    // The curated representative first: it is the one placed on the equator.
    const fallback = [...own.filter((photo) => photo.id === group.mediaId), ...own.filter((photo) => photo.id !== group.mediaId)].slice(0, PER_SPECIALTY);
    const ordered = curated.length ? curated : fallback;
    return ordered.length
      ? ordered.map((photo) => ({
        key: photo.id, kind: 'photo', specialtyId: group.id, image: photo.thumb ?? photo.image, zoomImage: photo.image, alt: photo.alt, caption: photo.caption, label: group.name, tag: group.category,
        focus: photo.id === group.mediaId && group.focus ? group.focus : photo.objectPosition ?? '50% 50%',
      }))
      : [{ key: `emblem-${group.id}`, kind: 'emblem', specialtyId: group.id, caption: pendingPhotosNote(group.name), label: group.name, tag: group.category, focus: '50% 50%' }];
  });
  const interiors = stops.flatMap((stop) => photos.filter((photo) => photo.id === stop.mediaId && photo.category === 'espacio')
    .map((photo): Content => ({ key: photo.id, kind: 'photo', image: photo.thumb ?? photo.image, zoomImage: photo.image, alt: photo.alt, caption: `El espacio · ${stop.area}: ${stop.title}`, label: 'El espacio', tag: 'espacio', focus: photo.objectPosition ?? '50% 50%' })));
  const clips = videos.map((video): Content => ({
    key: video.id, kind: 'video', specialtyId: groups.find((group) => group.category === video.category)?.id, image: video.posterImage, zoomImage: video.posterImage, video: video.src,
    alt: video.alt, caption: video.caption, label: video.title, tag: video.category, focus: video.objectPosition,
  }));
  const heroClip = videos.find((video) => video.featured) ? clips[videos.findIndex((video) => video.featured)] : undefined;
  const otherClips = clips.filter((clip) => clip !== heroClip);

  const contentCount = specialtyItems.reduce((sum, items) => sum + items.length, 0) + interiors.length + clips.length;
  const points = fibonacciSphere(Math.max(MIN_PANELS, contentCount + MIN_FACETS));
  const taken = new Set<number>();
  const anchored: { point: SpherePoint; index: number; item: Content; size: number }[] = [];
  const anchor = (item: Content | undefined, target: SpherePoint, size: number) => {
    if (!item) return;
    const index = nearestFree(points, taken, target);
    if (index < 0) return;
    taken.add(index);
    anchored.push({ point: points[index]!, index, item, size });
  };
  anchor(heroClip, ringPoint(0), HERO_SIZE);
  specialtyItems.forEach((items, position) => anchor(items[0], ringPoint(SPECIALTY_SLOTS[position % SPECIALTY_SLOTS.length]!), FEATURED_SIZE));
  otherClips.forEach((clip, position) => anchor(clip, ringPoint(BACK_SLOT + position * 3), VIDEO_SIZE));

  // Everything else, dealt like cards (one of each kind in turn), then spread by kind.
  const queues = [...specialtyItems.map((items) => items.slice(1)), interiors];
  const dealt: Content[] = [];
  for (let round = 0; queues.some((queue) => queue.length > round); round++) {
    for (const queue of queues) if (queue[round]) dealt.push(queue[round]!);
  }
  const spread = spreadByTag(points, taken, anchored.map((entry) => ({ point: entry.point, tag: entry.item.tag })), dealt)
    .map((entry, order) => ({ ...entry, size: SIZES[order % SIZES.length]! }));

  const heroPoint = anchored.find((entry) => entry.item === heroClip)?.point;
  const first = heroPoint ?? anchored[0]?.point ?? { lat: 0, lon: 0 };
  // Free rotation (quaternions in the browser): the first piece starts exactly in front.
  const initial = orientationFacing(first, 90);
  const near = (point: SpherePoint) => Boolean(heroPoint) && point !== heroPoint && angularDistance(point, heroPoint!) < HERO_CLEARANCE;

  const panels: GlobePanel[] = [
    ...[...anchored, ...spread].map(({ point, item, size }) => {
      const { tag: _tag, ...content } = item;
      return { ...content, point, size: near(point) ? Math.min(size, NEIGHBOUR_SIZE) : size, hero: item === heroClip, shade: shadeFor(facingDepth(point, initial)), filler: false };
    }),
    ...points.map((_, index) => index).filter((index) => !taken.has(index)).map((index): GlobePanel => ({
      key: `facet-${index}`, kind: 'facet', point: points[index]!, size: (near(points[index]!) ? .56 : .62) + (index % 3) * .07, caption: '', label: '', focus: '50% 50%', hero: false,
      shade: shadeFor(facingDepth(points[index]!, initial)), filler: true,
    })),
  ];
  const specialties = groups.map((group, index): GlobeSpecialty => {
    const items = specialtyItems[index]!;
    return {
      id: group.id, number: group.number, name: group.name, description: group.description, message: group.message, category: group.category,
      works: items.some((item) => item.kind === 'photo'), featured: items[0]!.key,
    };
  });
  return { panels, specialties, initial, hero: heroClip?.key };
}
