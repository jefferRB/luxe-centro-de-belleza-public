import type { ImageMetadata } from 'astro';
import { isWork, workCategories, type MediaRecord, type PublicationPermission, type WorkCategory } from './media-catalog.ts';

/** Editorial copy per photograph, keyed by catalog id. Alt text, order, category and
 * permission stay in media-catalog.ts so no photo data is duplicated here. */
export interface PortfolioCopy { readonly title: string; readonly description: string }

export interface PortfolioItem {
  readonly id: string;
  readonly category: WorkCategory;
  readonly categoryLabel: string;
  readonly image: ImageMetadata;
  readonly alt: string;
  readonly caption: string;
  /** The category's editorial line (one per category, never repeated across them). */
  readonly tagline: string;
  readonly title: string;
  readonly description: string;
  readonly ctaLabel: string;
  readonly order: number;
  readonly objectPosition: `${number}% ${number}%`;
  readonly authorizationStatus: PublicationPermission['status'];
}

export interface PortfolioCategory { readonly id: WorkCategory; readonly label: string; readonly count: number }

/** One line per category: what that kind of work says, without promising results. */
export const categoryTagline: Readonly<Record<WorkCategory, string>> = {
  cortes: 'Cada corte tiene su propio carácter.',
  peluqueria: 'Color, forma y estilo en cada transformación.',
  unas: 'Diseños que expresan tu estilo.',
  cejas: 'Precisión que realza tu mirada.',
  faciales: 'Un momento dedicado al cuidado de tu piel.',
};

export const categoryCta: Readonly<Record<WorkCategory, string>> = {
  cortes: 'Reservar mi corte', peluqueria: 'Reservar mi cita', unas: 'Reservar mi cita', cejas: 'Reservar mi cita', faciales: 'Reservar mi cita',
};

/** Proposed copy (status PROPUESTO): describes what is visible, never techniques,
 * results or benefits that the photographs cannot confirm. */
export const portfolioCopy: Readonly<Record<string, PortfolioCopy>> = {
  'corte-textura': { title: 'Textura arriba, degradado al costado.', description: 'Un corte corto con volumen trabajado en la parte superior y una transición limpia hacia la sien.' },
  'unas-flores': { title: 'Flores sobre rosa.', description: 'Uñas almendradas en rosa con puntas blancas, flores blancas y pequeños toques dorados.' },
  'cejas-definidas': { title: 'Cejas con forma propia.', description: 'Un diseño definido, visto de cerca, que enmarca la mirada y acompaña las facciones.' },
  'unas-azul': { title: 'Color con carácter.', description: 'Azul, blanco y pequeños acentos dorados, para quien disfruta que sus manos se noten.' },
  'corte-peinado': { title: 'Líneas limpias, estilo propio.', description: 'Un degradado suave y un peinado con forma. Pensado para acompañarte en tu día a día.' },
  'facial-proceso': { title: 'Limpieza facial, en proceso.', description: 'Manos con guantes trabajan con atención en cada zona del rostro durante la limpieza.' },
  'unas-rosa': { title: 'Delicadeza en lo pequeño.', description: 'Tonos suaves y líneas doradas: un estilo sencillo que igual se luce.' },
  'corte-rizado': { title: 'Tu textura, tu estilo.', description: 'Rizos con volumen arriba y laterales degradados. Un corte que trabaja con lo natural de tu cabello.' },
  'corte-barba': { title: 'Corte y barba en equilibrio.', description: 'Contornos definidos y un degradado que acompaña la barba, para que todo se vea en armonía.' },
  'corte-linea': { title: 'Una línea con carácter.', description: 'Una raya marcada y un degradado limpio: esos pequeños detalles que cambian todo el estilo.' },
  'corte-fade-perfil': { title: 'Degradado y textura.', description: 'Un degradado bajo y textura arriba, con el perfil limpio y definido.' },
  'barba-trabajo': { title: 'La barba, con forma.', description: 'Contornos definidos y una barba perfilada para acompañar el rostro.' },
  'unas-borgona': { title: 'Borgoña con un toque dorado.', description: 'Uñas almendradas en borgoña y nude, con pequeños detalles dorados.' },
  'peluqueria-rubio-ondas': { title: 'Ondas que se mueven.', description: 'Un rubio con degradado de color y ondas definidas, de raíz a puntas.' },
  'peluqueria-liso': { title: 'Largo y liso.', description: 'Cabello largo, liso y con caída uniforme, de punta a punta.' },
  // Mundo LUXE: starting from the package manifest, in the site's editorial voice.
  'barberia-perfil-barba': { title: 'El perfil, bien definido.', description: 'Cabeza rasurada y una barba delineada con contornos limpios, de la patilla al mentón.' },
  'peluqueria-rubio-texturizado': { title: 'Rubio con textura.', description: 'Un rubio platinado con textura arriba y un degradado suave en los lados.' },
  'unas-vino-animal-print': { title: 'Vino, líneas y estampado.', description: 'Tonos vino y rosa combinados con líneas, lunares y un toque de estampado animal.' },
  'unas-grafico': { title: 'Arte gráfico en tus manos.', description: 'Blanco y negro con detalles en rojo: diseños distintos en cada uña, pensados como un conjunto.' },
  'unas-francesa-flores': { title: 'Una francesa con flores.', description: 'Rosa y blanco en estilo francesa, con flores blancas en relieve como detalle protagonista.' },
  'facial-aparatologia': { title: 'Cuidado facial con aparatología.', description: 'En camilla, una profesional aplica un equipo de estética sobre el rostro.' },
  'unas-dorado-puntos': { title: 'Puntos y un toque dorado.', description: 'Rosa, negro y blanco con un acabado dorado y puntos decorativos que se lucen juntos.' },
  'unas-azul-animal-print': { title: 'Azul con personalidad.', description: 'Azul intenso, francesa blanca, estampado animal y pequeños brillos en una misma mano.' },
};

/** `copy` comes with works uploaded from the admin; catalog works use portfolioCopy. */
type RenderableWork = MediaRecord & { readonly image: ImageMetadata; readonly copy?: PortfolioCopy };

export function buildPortfolio(media: readonly RenderableWork[]): PortfolioItem[] {
  return media
    .filter((item): item is RenderableWork & { category: WorkCategory } => isWork(item))
    .map((item) => {
      const copy = item.copy ?? portfolioCopy[item.id];
      // Fail the build instead of publishing a photo without reviewed copy.
      if (!copy) throw new Error(`Portfolio copy missing for ${item.id}`);
      return {
        id: item.id,
        category: item.category,
        categoryLabel: workCategories[item.category],
        image: item.image,
        alt: item.alt,
        caption: item.caption,
        tagline: categoryTagline[item.category],
        title: copy.title,
        description: copy.description,
        ctaLabel: categoryCta[item.category],
        order: item.order,
        objectPosition: item.objectPosition ?? '50% 50%',
        authorizationStatus: item.permission.status,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** Only categories that contain at least one valid photograph, in declared order. */
export function portfolioCategories(items: readonly Pick<PortfolioItem, 'category'>[]): PortfolioCategory[] {
  return (Object.keys(workCategories) as WorkCategory[])
    .map((id) => ({ id, label: workCategories[id], count: items.filter((item) => item.category === id).length }))
    .filter((category) => category.count > 0);
}
