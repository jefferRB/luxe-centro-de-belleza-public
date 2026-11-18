import { dragoPublicLink } from '../lib/drago.ts';
import { googleMapsShareLink, instagramProfileLink, wazeShareLink, whatsappChatLink } from '../lib/public-links.ts';
import { luxe, type Confirmation, type LuxeConfig } from './luxe.ts';

/** The single source of outbound URLs: header, specialties, showcase, dock, visit section and footer. */
export interface PublicLinks {
  readonly booking?: string;
  readonly whatsapp?: string;
  readonly instagram?: string;
  readonly instagramHandle?: string;
  readonly maps?: string;
  readonly waze?: string;
}

const confirmed = <T>(entry: Confirmation<T>): T | undefined => entry.status === 'confirmed' ? entry.value : undefined;

export function resolvePublicLinks(config: LuxeConfig): PublicLinks {
  const slug = confirmed(config.drago.slug);
  const whatsapp = confirmed(config.contact.whatsapp);
  const instagramHandle = confirmed(config.contact.instagram);
  const maps = confirmed(config.contact.maps);
  const waze = confirmed(config.contact.waze);
  return {
    // Only the general booking page: Drago has no documented public service preselection.
    booking: slug && confirmed(config.drago.modules.reservar) === true ? dragoPublicLink('reservar', slug) : undefined,
    whatsapp: whatsapp ? whatsappChatLink(whatsapp) : undefined,
    instagram: instagramHandle ? instagramProfileLink(instagramHandle) : undefined,
    instagramHandle,
    maps: maps ? googleMapsShareLink(maps) : undefined,
    waze: waze ? wazeShareLink(waze) : undefined,
  };
}

export const publicLinks = resolvePublicLinks(luxe);

/** Every URL that may leave the site. Build checks reject anything else. */
export const outboundAllowlist: readonly string[] = [publicLinks.booking, publicLinks.whatsapp, publicLinks.instagram, publicLinks.maps, publicLinks.waze]
  .filter((link): link is string => Boolean(link));
