import type { ImageMetadata } from 'astro';
import { manifest, uploads } from 'virtual:luxe-managed-media';
import { applyManifest, resolveServiceGroups, resolveSingle, resolveSpaceStops, type ResolvedMedia } from '../lib/media-resolve';
import { HERO_ID, type UploadRef } from '../lib/media-manifest';
import { canShow, canUseMedia, canUseVideo, mediaCatalog, receptionPhoto, showsDemoMedia, videoCatalog, type VideoRecord } from './media-catalog';
import { catalogImages, catalogThumbs, catalogVideos, receptionImage } from './media.assets';
import { services, type ServiceGroup } from './services';
import { spaceTour, type SpaceStop } from './spaces';

/** A publishable photo: the curated catalog plus the admin's changes (managed-media). */
export type RenderableMedia = ResolvedMedia<ImageMetadata>;

export interface RenderableVideo extends VideoRecord {
  /** URL of the muted loop (requested only when the clip is about to play). */
  readonly src: string;
  readonly posterImage: ImageMetadata;
}

interface VideoAsset { readonly src: string; readonly poster: ImageMetadata }

/** `astro dev` may preview media under review; builds never do (data/media-catalog.ts). */
const LOCAL_PREVIEW = import.meta.env.DEV;

const uploadImage = (ref: UploadRef): ImageMetadata | undefined => uploads[ref.file];

export async function getMedia(): Promise<readonly RenderableMedia[]> {
  const images: Readonly<Record<string, ImageMetadata>> = catalogImages;
  const thumbs: Readonly<Record<string, ImageMetadata>> = catalogThumbs;
  const curated = mediaCatalog
    .filter((item) => canUseMedia(item, LOCAL_PREVIEW) && images[item.id])
    .map((item) => ({ ...item, image: images[item.id]!, thumb: thumbs[item.id] }))
    .sort((a, b) => a.order - b.order);
  return applyManifest(curated, manifest, uploadImage);
}

/** Videos follow the same publication policy as photos. */
export async function getVideos(): Promise<readonly RenderableVideo[]> {
  const videos: Readonly<Record<string, VideoAsset>> = catalogVideos;
  return videoCatalog
    .filter((item) => canUseVideo(item, LOCAL_PREVIEW) && videos[item.id])
    .map((item) => ({ ...item, src: videos[item.id]!.src, posterImage: videos[item.id]!.poster }))
    .sort((a, b) => a.order - b.order);
}

/** Specialties with the admin's Mundo LUXE selection. */
export const getServiceGroups = (): readonly ServiceGroup[] => resolveServiceGroups(services, manifest);

/** The interior walk, in the admin's order. */
export const getSpaceStops = (): readonly SpaceStop[] => resolveSpaceStops(spaceTour, manifest);

/** The hero photo (the reception, unless the admin replaced it); null when not publishable. */
export async function getHeroPhoto(): Promise<{ readonly image: ImageMetadata; readonly alt: string } | null> {
  if (!canShow(receptionPhoto.permission, LOCAL_PREVIEW)) return null;
  return resolveSingle(HERO_ID, { image: receptionImage, alt: receptionPhoto.alt }, manifest, uploadImage);
}

/** Whether the catalog media on this page are illustrative stand-ins (the footer says so). */
export const usesDemoMedia = (): boolean =>
  showsDemoMedia([...mediaCatalog.filter((item) => canUseMedia(item, LOCAL_PREVIEW)), ...videoCatalog.filter((item) => canUseVideo(item, LOCAL_PREVIEW)), receptionPhoto]);

/** Whether `astro dev` is previewing client media that is still under review. */
export const previewsUnapprovedMedia = (): boolean =>
  LOCAL_PREVIEW && [...mediaCatalog, ...videoCatalog, receptionPhoto].some((item) => item.permission.status === 'local-preview');
