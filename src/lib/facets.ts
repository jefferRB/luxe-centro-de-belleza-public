/** LUXE diamond facets: six pieces that tile a frame exactly. The two central facets
 * (crown + pavilion) form the brand diamond; the globe's emerald emblems draw them.
 * Pure and deterministic. */
export type Point = readonly [x: number, y: number];
export interface Facet { readonly id: string; readonly points: readonly Point[]; readonly fill: string }

const GIRDLE = 40;
export const FACETS: readonly Facet[] = [
  { id: 'crown-left', points: [[0, 0], [50, 0], [34, GIRDLE], [0, GIRDLE]], fill: '#0f3a2f' },
  { id: 'crown', points: [[50, 0], [66, GIRDLE], [34, GIRDLE]], fill: '#1d5a49' },
  { id: 'crown-right', points: [[50, 0], [100, 0], [100, GIRDLE], [66, GIRDLE]], fill: '#14473a' },
  { id: 'pavilion-right', points: [[66, GIRDLE], [100, GIRDLE], [100, 100], [50, 100]], fill: '#0b2c24' },
  { id: 'pavilion', points: [[34, GIRDLE], [66, GIRDLE], [50, 100]], fill: '#165041' },
  { id: 'pavilion-left', points: [[0, GIRDLE], [34, GIRDLE], [50, 100], [0, 100]], fill: '#0d3329' },
];

/** Shoelace area in unit-square percentages (the six facets sum to 10 000). */
export function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  points.forEach(([x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length]!;
    twice += x * ny - nx * y;
  });
  return Math.abs(twice) / 2;
}

export function centroid(points: readonly Point[]): Point {
  const [x, y] = points.reduce(([sx, sy], [px, py]) => [sx + px, sy + py], [0, 0]);
  return [x / points.length, y / points.length];
}
