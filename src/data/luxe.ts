import type { DragoRoute } from '../lib/drago.ts';
import type { WeeklySchedule } from '../lib/opening-hours.ts';

export type Confirmation<T> =
  | { readonly status: 'pending' }
  | { readonly status: 'confirmed'; readonly value: T; readonly source: string; readonly reviewedAt: string };
/** Only what the owner confirmed: no street, coordinates or postal code are inferred. */
export interface PostalAddress {
  readonly locality: string;
  readonly canton: string;
  readonly province: string;
  readonly country: string;
  readonly countryCode: 'CR';
}
export interface LuxeConfig {
  readonly brand: { readonly name: string; readonly descriptor: string };
  readonly location: string;
  readonly metadata: { readonly title: string; readonly description: string };
  /** Link-preview card (Open Graph / Twitter) shown when the site is shared. */
  readonly social: { readonly title: string; readonly description: string };
  readonly introduction: { readonly eyebrow: string; readonly title: string; readonly accent: string; readonly description: string };
  readonly canonicalOrigin: Confirmation<string>;
  /** Each public channel is confirmed on its own; nothing is inferred from photos or video. */
  readonly contact: {
    readonly whatsapp: Confirmation<string>;
    readonly instagram: Confirmation<string>;
    readonly maps: Confirmation<string>;
    readonly waze: Confirmation<string>;
    readonly address: Confirmation<PostalAddress>;
    readonly hours: Confirmation<WeeklySchedule>;
  };
  readonly drago: { readonly slug: Confirmation<string>; readonly modules: Readonly<Record<DragoRoute, Confirmation<boolean>>> };
  readonly mediaPermission: Confirmation<boolean>;
}

const phase32Brief = {
  source: 'Official links confirmed by the business owner',
  reviewedAt: '2026-10-30',
} as const;
const phase4Brief = {
  source: 'Address, opening hours and Waze link confirmed by the business owner',
  reviewedAt: '2026-11-03',
} as const;

export const luxe = {
  brand: { name: 'LUXE', descriptor: 'Centro de Belleza Familiar' },
  location: 'Concepción, La Unión, Cartago',
  metadata: {
    title: 'LUXE Centro de Belleza | Barbería y Belleza en Concepción',
    description: 'Conocé LUXE Centro de Belleza en Concepción, La Unión, Cartago: barbería, peluquería, uñas, cejas y cuidado facial. Mirá nuestros trabajos y reservá en línea.',
  },
  social: {
    title: 'LUXE | Centro de Belleza Familiar',
    description: 'Tu estilo. Tu momento. Tu espacio. Barbería, peluquería, uñas y cuidado personal en Concepción, La Unión, Cartago.',
  },
  introduction: {
    eyebrow: 'Belleza · Estilo · Bienestar',
    title: 'Tu estilo. Tu momento.',
    accent: 'Tu espacio.',
    description: 'Barbería, peluquería, uñas y cuidado personal en un espacio creado para vos.',
  },
  canonicalOrigin: {
    status: 'confirmed',
    value: 'https://www.luxecentrobelleza.com',
    source: 'Canonical domain confirmed by the business owner',
    reviewedAt: '2026-11-09',
  },
  contact: {
    whatsapp: { status: 'confirmed', value: '50671620752', ...phase32Brief },
    instagram: { status: 'confirmed', value: 'luxe_centrodebelleza', ...phase32Brief },
    maps: { status: 'confirmed', value: 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6', ...phase32Brief },
    waze: { status: 'confirmed', value: 'https://waze.com/ul/hd1u22w6m3', ...phase4Brief },
    address: {
      status: 'confirmed',
      value: { locality: 'Concepción', canton: 'La Unión', province: 'Cartago', country: 'Costa Rica', countryCode: 'CR' },
      ...phase4Brief,
    },
    hours: {
      status: 'confirmed',
      value: {
        // Always Costa Rica time, wherever the visitor is.
        timeZone: 'America/Costa_Rica',
        periods: ([1, 2, 3, 4, 5, 6] as const).map((day) => ({ day, opens: '09:00', closes: '19:00' } as const)),
      },
      ...phase4Brief,
    },
  },
  drago: {
    slug: { status: 'confirmed', value: 'luxecentrobelleza', ...phase32Brief },
    modules: {
      reservar: { status: 'confirmed', value: true, ...phase32Brief },
      fidelidad: { status: 'pending' },
      opinar: { status: 'pending' },
    },
  },
  mediaPermission: { status: 'pending' },
} as const satisfies LuxeConfig;
