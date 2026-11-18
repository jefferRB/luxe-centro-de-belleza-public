import type { WorkCategory } from './media-catalog.ts';

/** Editorial groups based on the documented, observed catalog; not a live offer.
 * Each group points to the showcase category that demonstrates it (no duplicate taxonomy). */
export interface ServiceGroup {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly description: string;
  readonly category: WorkCategory;
  /** Signature Reveal copy (status PROPUESTO): no results or guarantees. */
  readonly message: string;
  /** Representative photo: a catalog id of the same category. Absent ⇒ editorial fallback. */
  readonly mediaId?: string;
  /** Framing inside the 4:5 Signature frame, only where the original is taller. */
  readonly focus?: `${number}% ${number}%`;
  /** Curated works for the Mundo LUXE globe, in order (the first is `mediaId`). The globe is a
   * representative mix, not the full archive: every work stays in the gallery below. */
  readonly globe?: readonly string[];
}

export const services: readonly ServiceGroup[] = [
  { id: 'barberia', number: '01', name: 'Barbería y barba', description: 'Cortes, degradados y barba perfilada.', category: 'cortes', message: 'Desde un retoque hasta un cambio completo, con la barba en armonía con tu corte.', mediaId: 'corte-peinado', focus: '50% 40%', globe: ['corte-peinado', 'barberia-perfil-barba', 'corte-fade-perfil', 'corte-rizado'] },
  { id: 'peluqueria', number: '02', name: 'Peluquería', description: 'Cortes, color y peinado.', category: 'peluqueria', message: 'Rubios, ondas o un liso de punta a punta: tu cabello, a tu manera.', mediaId: 'peluqueria-rubio-ondas', focus: '50% 58%', globe: ['peluqueria-rubio-ondas', 'peluqueria-rubio-texturizado', 'peluqueria-liso'] },
  { id: 'unas-pedicura', number: '03', name: 'Uñas y pedicura', description: 'Manicura, diseños y pedicura.', category: 'unas', message: 'Del tono más sutil al diseño más atrevido, para tus manos y tus pies.', mediaId: 'unas-flores', focus: '50% 46%', globe: ['unas-flores', 'unas-grafico', 'unas-dorado-puntos', 'unas-azul-animal-print'] },
  { id: 'cejas', number: '04', name: 'Cejas', description: 'Diseño y definición de cejas.', category: 'cejas', message: 'Una forma definida que acompaña tus facciones y enmarca la mirada.', mediaId: 'cejas-definidas', globe: ['cejas-definidas'] },
  { id: 'facial', number: '05', name: 'Cuidado facial', description: 'Limpieza facial y cuidado de la piel.', category: 'faciales', message: 'Un rato para vos, en camilla y con atención profesional.', mediaId: 'facial-proceso', globe: ['facial-proceso', 'facial-aparatologia'] },
];

/** El Mundo LUXE: the contextual line of the facial ritual clip that leads the globe. It tells
 * what is on screen; the section title («Un mundo de belleza…») never changes. */
export const mundoIntro = {
  eyebrow: 'En primer plano · Cuidado facial',
  title: 'El cuidado se siente en cada detalle.',
  message: 'Un momento para relajarte y disfrutar de una atención dedicada.',
} as const;
