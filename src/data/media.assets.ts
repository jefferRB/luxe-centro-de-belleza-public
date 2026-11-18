/** Asset registry: one import per catalog record (data/media-catalog.ts), so astro:assets
 * optimises each image (AVIF/WebP, srcset, dimensions). The public repository ships only the
 * generated demonstration media in src/assets/demo (see its manifest.json). */
import corteTextura from '../assets/demo/works/corte-textura.webp';
import unasFlores from '../assets/demo/works/unas-flores.webp';
import cejas from '../assets/demo/works/cejas-definidas.webp';
import unasAzul from '../assets/demo/works/unas-azul.webp';
import cortePeinado from '../assets/demo/works/corte-peinado.webp';
import facial from '../assets/demo/works/facial-proceso.webp';
import unasRosa from '../assets/demo/works/unas-rosa.webp';
import corteRizado from '../assets/demo/works/corte-rizado.webp';
import corteBarba from '../assets/demo/works/corte-barba.webp';
import corteLinea from '../assets/demo/works/corte-linea.webp';
import estaciones from '../assets/demo/spaces/estaciones.webp';
import salon from '../assets/demo/spaces/salon.webp';
import espera from '../assets/demo/spaces/espera.webp';
import barberiaPerspectiva from '../assets/demo/spaces/barberia-perspectiva.webp';
import manicura from '../assets/demo/spaces/manicura.webp';
import fachada from '../assets/demo/spaces/fachada.webp';
import corteFade from '../assets/demo/works/corte-fade-perfil.webp';
import corteFadeGlobo from '../assets/demo/globe/corte-fade-perfil-globo.webp';
import barba from '../assets/demo/works/barba-trabajo.webp';
import barbaGlobo from '../assets/demo/globe/barba-trabajo-globo.webp';
import unasBorgona from '../assets/demo/works/unas-borgona.webp';
import unasBorgonaGlobo from '../assets/demo/globe/unas-borgona-globo.webp';
import rubioOndas from '../assets/demo/works/peluqueria-rubio-ondas.webp';
import rubioOndasGlobo from '../assets/demo/globe/peluqueria-rubio-ondas-globo.webp';
import liso from '../assets/demo/works/peluqueria-liso.webp';
import lisoGlobo from '../assets/demo/globe/peluqueria-liso-globo.webp';
import perfilBarba from '../assets/demo/works/barberia-perfil-barba.webp';
import rubioTexturizado from '../assets/demo/works/peluqueria-rubio-texturizado.webp';
import unasVino from '../assets/demo/works/unas-vino-animal-print.webp';
import unasGrafico from '../assets/demo/works/unas-grafico.webp';
import unasFrancesa from '../assets/demo/works/unas-francesa-flores.webp';
import facialAparatologia from '../assets/demo/works/facial-aparatologia.webp';
import unasDorado from '../assets/demo/works/unas-dorado-puntos.webp';
import unasAzulPrint from '../assets/demo/works/unas-azul-animal-print.webp';
import recepcion from '../assets/demo/hero/recepcion.webp';
import ritualClip from '../assets/demo/videos/ritual-toallas-calidas.webm';
import ritualPoster from '../assets/demo/posters/ritual-toallas-calidas.webp';
import limpiezaClip from '../assets/demo/videos/limpieza-facial.webm';
import limpiezaPoster from '../assets/demo/posters/limpieza-facial.webp';

export const catalogImages = {
  'corte-textura': corteTextura, 'unas-flores': unasFlores, 'cejas-definidas': cejas,
  'unas-azul': unasAzul, 'corte-peinado': cortePeinado, 'facial-proceso': facial,
  'unas-rosa': unasRosa, 'corte-rizado': corteRizado, 'corte-barba': corteBarba,
  'corte-linea': corteLinea, estaciones, salon, espera,
  'barberia-perspectiva': barberiaPerspectiva, manicura, fachada,
  'corte-fade-perfil': corteFade, 'barba-trabajo': barba, 'unas-borgona': unasBorgona,
  'peluqueria-rubio-ondas': rubioOndas, 'peluqueria-liso': liso,
  'barberia-perfil-barba': perfilBarba, 'peluqueria-rubio-texturizado': rubioTexturizado,
  'unas-vino-animal-print': unasVino, 'unas-grafico': unasGrafico, 'unas-francesa-flores': unasFrancesa,
  'facial-aparatologia': facialAparatologia, 'unas-dorado-puntos': unasDorado, 'unas-azul-animal-print': unasAzulPrint,
};

/** Light variants for the globe's small panels (catalog `thumbSource`). */
export const catalogThumbs = {
  'corte-fade-perfil': corteFadeGlobo, 'barba-trabajo': barbaGlobo, 'unas-borgona': unasBorgonaGlobo,
  'peluqueria-rubio-ondas': rubioOndasGlobo, 'peluqueria-liso': lisoGlobo,
};

/** Mundo LUXE clips (catalog `videoCatalog`): the muted loop URL and its poster frame. */
export const catalogVideos = {
  'ritual-toallas-calidas': { src: ritualClip, poster: ritualPoster },
  'limpieza-facial': { src: limpiezaClip, poster: limpiezaPoster },
};

/** The hero image (catalog `receptionPhoto`). */
export const receptionImage = recepcion;
