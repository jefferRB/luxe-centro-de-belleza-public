import type { WeeklySchedule, Weekday } from '../lib/opening-hours.ts';
import type { PublicLinks } from './links.ts';
import type { Confirmation, LuxeConfig } from './luxe.ts';

/** schema.org data for local search, built only from confirmed values in luxe.ts and
 * links.ts: no street, coordinates, prices, ratings or reviews are invented. The only
 * phone is the confirmed WhatsApp line; the URL needs the confirmed canonical domain. */
const SCHEMA_DAYS: Readonly<Record<Weekday, string>> = {
  0: 'https://schema.org/Sunday', 1: 'https://schema.org/Monday', 2: 'https://schema.org/Tuesday', 3: 'https://schema.org/Wednesday',
  4: 'https://schema.org/Thursday', 5: 'https://schema.org/Friday', 6: 'https://schema.org/Saturday',
};

function openingHoursSpecification(schedule: WeeklySchedule) {
  // Days with identical hours share one specification.
  const groups = new Map<string, Weekday[]>();
  for (const period of schedule.periods) {
    const key = `${period.opens}-${period.closes}`;
    groups.set(key, [...(groups.get(key) ?? []), period.day]);
  }
  return [...groups].map(([key, days]) => {
    const [opens, closes] = key.split('-');
    return { '@type': 'OpeningHoursSpecification', dayOfWeek: days.map((day) => SCHEMA_DAYS[day]), opens, closes };
  });
}

const confirmed = <T>(entry: Confirmation<T>): T | undefined => entry.status === 'confirmed' ? entry.value : undefined;

const businessName = (config: LuxeConfig) => `${config.brand.name} Centro de Belleza`;
/** Real variants of the business name (its descriptor and the domain spelling), so searches
 * written differently resolve to the same business. */
const alternateNames = (config: LuxeConfig) => [
  config.brand.name,
  `${config.brand.name} ${config.brand.descriptor}`,
  'Luxe Centro Belleza',
];

/** Site name shown by Google above the result (WebSite on the home page only). */
export function buildWebSite(config: LuxeConfig, homeUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${homeUrl}#sitio`,
    url: homeUrl,
    name: businessName(config),
    alternateName: alternateNames(config),
    inLanguage: 'es-CR',
  };
}

/** Absolute URLs of this page and its social image, when the canonical domain is confirmed. */
export interface PageUrls { readonly url?: string; readonly image?: string }

export function buildLocalBusiness(config: LuxeConfig, links: PublicLinks, services: readonly { readonly name: string }[], page: PageUrls = {}) {
  const address = confirmed(config.contact.address);
  const hours = confirmed(config.contact.hours);
  const whatsapp = confirmed(config.contact.whatsapp);
  return {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    ...(page.url && { '@id': `${page.url}#negocio`, url: page.url }),
    name: businessName(config),
    alternateName: alternateNames(config),
    description: config.metadata.description,
    ...(page.image && { image: page.image }),
    // The confirmed WhatsApp number is the business's public contact line.
    ...(whatsapp && { telephone: `+${whatsapp}` }),
    ...(address && {
      address: { '@type': 'PostalAddress', addressLocality: `${address.locality}, ${address.canton}`, addressRegion: address.province, addressCountry: address.countryCode },
      areaServed: `${address.locality}, ${address.canton}, ${address.province}`,
    }),
    ...(hours && { openingHoursSpecification: openingHoursSpecification(hours) }),
    ...(links.maps && { hasMap: links.maps }),
    ...(links.instagram && { sameAs: [links.instagram] }),
    knowsAbout: services.map((service) => service.name),
    ...(links.booking && { potentialAction: { '@type': 'ReserveAction', target: links.booking } }),
  };
}
