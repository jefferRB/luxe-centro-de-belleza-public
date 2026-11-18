const DRAGO_PUBLIC_ORIGIN = 'https://www.dragocr.com';
const routes = ['reservar', 'fidelidad', 'opinar'] as const;
export type DragoRoute = (typeof routes)[number];

/** Only verified business slugs, never visitor data. Syntax validation does
 * not confirm tenant ownership, route availability or module activation. */
export function dragoPublicLink(kind: DragoRoute, slug: string): string {
  if (typeof kind !== 'string' || !routes.some((route) => route === kind)) {
    throw new TypeError('Ruta pública Drago no válida');
  }
  if (typeof slug !== 'string' || slug.length > 63 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || /[\r\n]/.test(slug)) {
    throw new TypeError('Slug público Drago no válido');
  }
  return `${DRAGO_PUBLIC_ORIGIN}/${kind}/${slug}`;
}
