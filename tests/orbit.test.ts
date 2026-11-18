import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragUnit, easeOutCubic, frontIndex, poseFor, poseTransform, resistBeyond, settleTarget, shortestTarget, swipeTarget, tweenDuration, wrapOffset, type OrbitProfile } from '../src/lib/orbit-layout.ts';
import { spaceTour, buildSpaceTour, FACADE_MEDIA_ID } from '../src/data/spaces.ts';
import { canUseMedia, mediaCatalog } from '../src/data/media-catalog.ts';
import { buildLocalBusiness } from '../src/data/structured-data.ts';
import { luxe } from '../src/data/luxe.ts';
import { publicLinks } from '../src/data/links.ts';
import { services } from '../src/data/services.ts';

const arc: OrbitProfile = { step: 40, radius: 460, facing: .78, lift: 60, scatter: 0, reach: 2.2, backOpacity: .4, focusScale: 0 };
const wideArc: OrbitProfile = { ...arc, step: 36, reach: Infinity, scatter: 50, focusScale: .16 };

test('desplazamientos circulares: el último trabajo queda justo antes del primero', () => {
  assert.equal(wrapOffset(9, 10), -1);
  assert.equal(wrapOffset(-6, 10), 4);
  assert.ok(Math.abs(wrapOffset(.4, 10) - .4) < 1e-9);
  assert.equal(frontIndex(-1, 10), 9);
  assert.equal(frontIndex(12.4, 10), 2);
  assert.equal(shortestTarget(0, 9, 10), -1);
  assert.equal(shortestTarget(8.6, 1, 10), 11);
});

test('la tarjeta del frente está centrada, sin rotar, delante de todas y opaca', () => {
  for (const profile of [arc, wideArc]) {
    const front = poseFor(0, 10, profile, 0);
    assert.deepEqual([front.x, front.y, front.z, front.rotateY, front.opacity, front.prominence, front.hidden], [0, 0, 0, 0, 1, 1, false]);
    for (let offset = 1; offset < 10; offset++) {
      const other = poseFor(offset, 10, profile, offset);
      assert.ok(other.zIndex <= front.zIndex);
      assert.ok(other.z <= 0);
    }
  }
  assert.equal(poseFor(0, 10, wideArc).scale, 1.16);
  assert.equal(poseFor(0, 10, arc).scale, 1);
});

test('posiciones simétricas a ambos lados de la foto central', () => {
  const left = poseFor(-2, 10, arc, 0);
  const right = poseFor(2, 10, arc, 0);
  assert.equal(left.x, -right.x);
  assert.equal(left.z, right.z);
  assert.equal(left.rotateY, -right.rotateY);
  assert.ok(right.z < poseFor(1, 10, arc).z && right.opacity < poseFor(1, 10, arc).opacity);
});

test('corona: solo se ven los vecinos cercanos, sin rotación artificial con una sola foto', () => {
  assert.equal(poseFor(2, 10, arc).hidden, false);
  assert.equal(poseFor(3, 10, arc).hidden, true);
  assert.equal(poseFor(3, 10, arc).opacity, 0);
  const single = poseFor(0, 1, arc);
  assert.deepEqual([single.x, single.rotateY, single.hidden], [0, 0, false]);
  assert.ok(poseFor(1, 10, arc).y < 0, 'neighbours rise toward the back like a crown');
});

test('poses deterministas que solo producen transform y opacity', () => {
  assert.deepEqual(poseFor(1.3, 10, wideArc, 3), poseFor(1.3, 10, wideArc, 3));
  assert.match(poseTransform(poseFor(1, 10, arc)), /^translate3d\(-?[\d.]+px, -?[\d.]+px, -?[\d.]+px\) rotateY\(-?[\d.]+deg\) scale\([\d.]+\)$/);
});

test('arrastre: unidad proporcional al arco, inercia limitada y animaciones breves', () => {
  assert.ok(dragUnit(arc) > 48);
  assert.equal(dragUnit({ ...arc, radius: 10 }), 48);
  assert.equal(settleTarget(2.4, 0), 2);
  assert.equal(settleTarget(2.4, .01), 4);
  assert.equal(settleTarget(0, 10, 3), 3);
  assert.equal(settleTarget(0, -10, 2), -2);
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(tweenDuration(1) <= tweenDuration(4) && tweenDuration(40) <= 980);
});

test('deslizar en táctil: una foto por gesto, sin saltos ni posiciones intermedias', () => {
  // Within one item the crown follows the finger 1:1; beyond, it resists and never passes 1.25.
  assert.equal(resistBeyond(.6), .6);
  assert.equal(resistBeyond(-1), -1);
  assert.ok(resistBeyond(1.01) > 1 && resistBeyond(1.01) < 1.01);
  assert.ok(Math.abs(resistBeyond(-1.001) + 1.001) < 1e-5, 'continuous at the limit');
  assert.ok(resistBeyond(9) < 1.25 && resistBeyond(-9) > -1.25);
  assert.ok(resistBeyond(2) > resistBeyond(1.5), 'monotonic');
  // A quick flick reaches the neighbour; a hard one still moves a single photo.
  assert.equal(swipeTarget(.3, .004, 0, 52, 48, 2), 1);
  assert.equal(swipeTarget(1.2, .05, 0, 300, 48, 2), 1);
  assert.equal(swipeTarget(-1.2, -.05, 0, -300, 48, 2), -1);
  // Consecutive swipes count from the photo already on its way (base), not from the start.
  assert.equal(swipeTarget(1.6, .01, 1, 120, 48, 2), 2);
  // A deliberate but slow swipe (≥ 48 px) still advances; a short slow one snaps back.
  assert.equal(swipeTarget(.28, 0, 0, 48, 48), 1);
  assert.equal(swipeTarget(-.28, 0, 0, -48, 48), -1);
  assert.equal(swipeTarget(.17, 0, 0, 30, 48), 0);
  // Reversed at release: the visitor changed their mind, the photo stays.
  assert.equal(swipeTarget(.3, -.002, 0, 52, 48), 0);
  // Always a whole photo.
  for (const position of [-1.24, -.7, -.2, .2, .7, 1.24]) assert.ok(Number.isInteger(swipeTarget(position, 0, 0, position * 170, 48)));
});

test('recorrido de espacios: incluye las dos perspectivas de barbería y la manicura, sin la fachada', () => {
  const local = mediaCatalog.filter((item) => canUseMedia(item, true));
  const tour = buildSpaceTour(local);
  assert.deepEqual(tour.map((view) => view.mediaId), ['estaciones', 'barberia-perspectiva', 'salon', 'manicura', 'espera']);
  assert.equal(tour.filter((view) => view.area === 'Barbería').length, 2);
  assert.ok(!spaceTour.some((stop) => stop.mediaId === FACADE_MEDIA_ID));
  for (const stop of spaceTour) assert.doesNotMatch(`${stop.title} ${stop.description}`, /\d+\s*(estaciones|sillas|sillones)|₡|premio|mejor/i);
  // The demo build walks the same views; client media without approval never reaches a build.
  assert.deepEqual(buildSpaceTour(mediaCatalog.filter((item) => canUseMedia(item, false))).map((view) => view.mediaId), tour.map((view) => view.mediaId));
  assert.deepEqual(buildSpaceTour(mediaCatalog.map((item) => ({ ...item, permission: { status: 'local-preview' } as const })).filter((item) => canUseMedia(item, false))), []);
});

test('datos estructurados: solo datos confirmados, sin dirección exacta ni reseñas inventadas', () => {
  const data = buildLocalBusiness(luxe, publicLinks, services);
  assert.equal(data['@type'], 'BeautySalon');
  assert.equal(data.name, 'LUXE Centro de Belleza');
  assert.deepEqual(data.address, { '@type': 'PostalAddress', addressLocality: 'Concepción, La Unión', addressRegion: 'Cartago', addressCountry: 'CR' });
  assert.deepEqual(data.openingHoursSpecification, [{
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => `https://schema.org/${day}`),
    opens: '09:00', closes: '19:00',
  }]);
  assert.deepEqual(data.sameAs, [publicLinks.instagram]);
  assert.equal(data.potentialAction?.target, publicLinks.booking);
  // The only phone is the confirmed WhatsApp line; nothing else is invented.
  assert.equal(data.telephone, '+50671620752');
  const json = JSON.stringify(data);
  assert.doesNotMatch(json, /aggregateRating|review|streetAddress|geo|priceRange|"url"|"image"/);
  const page = buildLocalBusiness(luxe, publicLinks, services, { url: 'https://www.luxecentrobelleza.com/', image: 'https://www.luxecentrobelleza.com/_astro/foto.jpg' });
  assert.equal(page.url, 'https://www.luxecentrobelleza.com/');
  assert.equal(page['@id'], 'https://www.luxecentrobelleza.com/#negocio');
  assert.equal(page.image, 'https://www.luxecentrobelleza.com/_astro/foto.jpg');
});
