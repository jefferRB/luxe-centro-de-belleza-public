/** The photographic walk through LUXE ("Nuestro espacio"). Copy describes only what each
 * photo shows: no station counts, equipment claims or services inferred from the images.
 * Photos come from media-catalog.ts by id, so alt text and permissions live in one place. */
export interface SpaceStop {
  readonly mediaId: string;
  /** Area of the business this view belongs to; two views may share one. */
  readonly area: string;
  readonly title: string;
  readonly description: string;
}

export const spaceTour: readonly SpaceStop[] = [
  { mediaId: 'estaciones', area: 'Barbería', title: 'Estaciones y espejos', description: 'Sillones de barbero frente a espejos de contorno orgánico, bajo las luces geométricas del techo.' },
  { mediaId: 'barberia-perspectiva', area: 'Barbería', title: 'Otra perspectiva', description: 'La barbería desde otro ángulo: el sillón al centro, el lavacabezas y la amplitud del espacio.' },
  { mediaId: 'salon', area: 'Peluquería', title: 'Un lugar para tu momento', description: 'Una estación con espejo de contorno orgánico, mueble blanco y paredes verdes.' },
  { mediaId: 'manicura', area: 'Manicura', title: 'Área de manicura', description: 'Mesa con lámpara, repisas con esmaltes y un sillón reclinable, en un rincón propio.' },
  { mediaId: 'espera', area: 'Sala de espera', title: 'Antes de empezar', description: 'Un sofá, una mesa dorada y la calma del verde LUXE mientras llega tu turno.' },
];

/** The facade belongs to the visit section, not to the interior walk. */
export const FACADE_MEDIA_ID = 'fachada';

export type SpaceView<T> = SpaceStop & { readonly media: T };

/** Stops whose photo is available in this build, in tour order; missing photos are skipped. */
export function buildSpaceTour<T extends { readonly id: string; readonly category: string }>(media: readonly T[], stops: readonly SpaceStop[] = spaceTour): SpaceView<T>[] {
  return stops.flatMap((stop) => {
    const photo = media.find((item) => item.id === stop.mediaId && item.category === 'espacio');
    return photo ? [{ ...stop, media: photo }] : [];
  });
}
