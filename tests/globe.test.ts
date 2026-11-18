import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angularDistance, assignToPoints, decay, facingDepth, fibonacciSphere, nearestYaw, normalizeAngle, orientationFacing, rotatePoint, shadeFor, toVector } from '../src/lib/sphere.ts';
import { buildGlobe } from '../src/data/globe.ts';
import { services } from '../src/data/services.ts';
import { canUseMedia, canUseVideo, mediaCatalog, videoCatalog } from '../src/data/media-catalog.ts';

const fakeImage = { src: '/x.webp', width: 800, height: 1000, format: 'webp' } as const;
const local = mediaCatalog.filter((item) => canUseMedia(item, true)).map((item) => ({ ...item, image: fakeImage })) as never[];
/** Client media still under review (no approval): what a build of the real site shows before permissions are recorded. */
const underReview = <T extends object>(item: T): T => ({ ...item, permission: { status: 'local-preview' } });
const production = mediaCatalog.map(underReview).filter((item) => canUseMedia(item, false)).map((item) => ({ ...item, image: fakeImage })) as never[];
const demoBuild = mediaCatalog.filter((item) => canUseMedia(item, false)).map((item) => ({ ...item, image: fakeImage })) as never[];
const demoClips = videoCatalog.filter((item) => canUseVideo(item, false)).map((item) => ({ ...item, src: `/${item.id}.webm`, posterImage: fakeImage })) as never[];
const clips = videoCatalog.filter((item) => canUseVideo(item, true)).map((item) => ({ ...item, src: `/${item.id}.mp4`, posterImage: fakeImage })) as never[];
const productionClips = videoCatalog.map(underReview).filter((item) => canUseVideo(item, false)).map((item) => ({ ...item, src: `/${item.id}.mp4`, posterImage: fakeImage })) as never[];

test('esfera de Fibonacci: puntos unitarios, todas las latitudes y longitudes, sin filas planas', () => {
  const points = fibonacciSphere(26);
  assert.equal(points.length, 26);
  for (const point of points) assert.ok(Math.abs(Math.hypot(...toVector(point)) - 1) < 1e-9);
  // Every latitude is different: nothing lies on one horizontal line or a flat ring.
  assert.equal(new Set(points.map((point) => point.lat)).size, 26);
  assert.ok(Math.max(...points.map((point) => point.lat)) > 70 && Math.min(...points.map((point) => point.lat)) < -70);
  for (const [min, max] of [[-180, -90], [-90, 0], [0, 90], [90, 180]] as const) assert.ok(points.some((point) => point.lon >= min && point.lon < max));
  // Evenly spread: nearest neighbours are neither stacked nor far apart.
  const nearest = points.map((point, index) => Math.min(...points.filter((_, other) => other !== index).map((other) => angularDistance(point, other))));
  assert.ok(Math.min(...nearest) > 25 && Math.max(...nearest) < 50);
});

test('rotación: misma convención que el CSS; girar hacia un punto lo pone al frente', () => {
  assert.deepEqual(rotatePoint({ lat: 0, lon: 0 }, { yaw: 0, pitch: 0 }), [0, 0, 1]);
  assert.deepEqual(rotatePoint({ lat: 0, lon: 90 }, { yaw: 0, pitch: 0 }), [1, 0, 0]);
  assert.deepEqual(rotatePoint({ lat: 0, lon: 90 }, { yaw: -90, pitch: 0 }), [0, 0, 1]);
  // CSS y grows downwards: a northern point sits above the centre.
  assert.ok(rotatePoint({ lat: 30, lon: 0 }, { yaw: 0, pitch: 0 })[1] < 0);
  for (const point of [{ lat: 10, lon: 144 }, { lat: -20, lon: -100 }, { lat: 35, lon: 10 }]) {
    assert.ok(Math.abs(facingDepth(point, orientationFacing(point, 90)) - 1) < 1e-3);
  }
  // No tilt limit any more: even a polar point comes exactly to the front.
  const polar = { lat: 78, lon: 0 };
  assert.ok(Math.abs(facingDepth(polar, orientationFacing(polar, 90)) - 1) < 1e-3);
  // The helper still honours a limit when one is asked for.
  assert.equal(orientationFacing(polar, 38).pitch, -38);
});

test('rotar 90° y 180° lleva al frente las fotografías que estaban detrás', () => {
  const back = { lat: 5, lon: 180 };
  assert.ok(facingDepth(back, { yaw: 0, pitch: 0 }) < -.9);
  assert.ok(facingDepth(back, { yaw: 180, pitch: 0 }) > .9);
  assert.ok(Math.abs(facingDepth({ lat: 0, lon: 90 }, { yaw: 0, pitch: 0 })) < 1e-3);
  assert.ok(facingDepth({ lat: 0, lon: 90 }, { yaw: -90, pitch: 0 }) > .99);
});

test('ángulos: normalización, camino corto, inercia que se detiene y sombreado por profundidad', () => {
  assert.equal(normalizeAngle(190), -170);
  assert.equal(normalizeAngle(-180), 180);
  assert.equal(normalizeAngle(720), 0);
  assert.equal(nearestYaw(170, -170), 190);
  assert.equal(nearestYaw(-170, 170), -190);
  let velocity = .8;
  let time = 0;
  while (Math.abs(velocity) > .003 && time < 5_000) { velocity = decay(velocity, 16); time += 16; }
  assert.ok(time < 2_000, `inertia stops in ${time} ms`);
  assert.equal(shadeFor(1), 0);
  assert.ok(shadeFor(.4) > shadeFor(.8));
  assert.equal(shadeFor(-1), shadeFor(0));
});

test('asignación: cada grupo ocupa la región de su ancla, sin repetir puntos', () => {
  const points = fibonacciSphere(26);
  const { placed, free } = assignToPoints(points, [
    { anchor: { lat: 0, lon: 0 }, items: ['a1', 'a2', 'a3'] },
    { anchor: { lat: 0, lon: 180 }, items: ['b1'] },
  ]);
  assert.equal(placed.length, 4);
  assert.equal(new Set(placed.map((entry) => entry.index)).size, 4);
  assert.equal(free.length, 22);
  for (const entry of placed.filter((item) => item.item.startsWith('a'))) assert.ok(angularDistance(entry.point, { lat: 0, lon: 0 }) < 60);
  assert.ok(angularDistance(placed.find((entry) => entry.item === 'b1')!.point, { lat: 0, lon: 180 }) < 40);
});

test('globo: una mezcla curada de fotos reales una sola vez, con su especialidad, y facetas solo de relleno', () => {
  const { panels, specialties } = buildGlobe(services, local, clips);
  const photos = panels.filter((panel) => panel.kind === 'photo');
  // 14 works (curated per specialty) + 5 interiors; every other work stays in the gallery.
  assert.equal(photos.length, 19);
  assert.equal(new Set(panels.filter((panel) => panel.kind !== 'facet').map((panel) => panel.key)).size, 21, 'no photo or clip is repeated');
  assert.equal(panels.length, 27);
  assert.ok(panels.filter((panel) => panel.kind === 'facet').length >= 6);
  assert.ok(!photos.some((panel) => panel.key === 'fachada'));
  assert.equal(new Set(panels.map((panel) => `${panel.point.lat},${panel.point.lon}`)).size, panels.length);
  assert.ok(panels.filter((panel) => panel.kind === 'facet').every((panel) => panel.filler && !panel.specialtyId && !panel.image));
  // Specialty metadata matches the catalog category of every work photo.
  const categories = Object.fromEntries(services.map((service) => [service.id, service.category]));
  for (const panel of photos.filter((item) => item.specialtyId)) {
    assert.equal(mediaCatalog.find((record) => record.id === panel.key)!.category, categories[panel.specialtyId!]);
  }
  // Interiors belong to no specialty.
  for (const id of ['estaciones', 'barberia-perspectiva', 'salon', 'manicura', 'espera']) assert.equal(photos.find((panel) => panel.key === id)?.specialtyId, undefined);
  assert.deepEqual(specialties.map((specialty) => [specialty.id, specialty.featured]), [
    ['barberia', 'corte-peinado'], ['peluqueria', 'peluqueria-rubio-ondas'], ['unas-pedicura', 'unas-flores'], ['cejas', 'cejas-definidas'], ['facial', 'facial-proceso'],
  ]);
  // Old and new material together: every new work category is represented.
  for (const id of ['barberia-perfil-barba', 'peluqueria-rubio-texturizado', 'unas-grafico', 'facial-aparatologia']) assert.ok(photos.some((panel) => panel.key === id), id);
  // Light variants on the panels; the lightbox always opens the full image.
  for (const id of ['corte-fade-perfil', 'peluqueria-rubio-ondas', 'peluqueria-liso']) {
    const panel = photos.find((item) => item.key === id)!;
    assert.ok(panel.zoomImage && panel.image, id);
  }
});

test('mundo variado: ninguna categoría domina y, gire donde gire, los vecinos son distintos', () => {
  const { panels, specialties } = buildGlobe(services, local, clips);
  const content = panels.filter((panel) => panel.kind !== 'facet');
  const tag = (panel: (typeof panels)[number]) => (panel.kind === 'video' ? `video-${panel.key}` : mediaCatalog.find((record) => record.id === panel.key)!.category);
  // Nine nails exist, but the globe never fills with them.
  const counts = new Map<string, number>();
  for (const panel of content) counts.set(tag(panel), (counts.get(tag(panel)) ?? 0) + 1);
  assert.ok(Math.max(...[...counts.values()]) <= 5, JSON.stringify([...counts]));
  for (const category of ['cortes', 'peluqueria', 'unas', 'cejas', 'faciales', 'espacio']) assert.ok(counts.get(category), category);
  // The nearest piece to any piece is never of the same kind.
  for (const panel of content) {
    const nearest = content.filter((other) => other !== panel).sort((a, b) => angularDistance(a.point, panel.point) - angularDistance(b.point, panel.point))[0]!;
    assert.notEqual(tag(nearest), tag(panel), `${panel.key} beside ${nearest.key}`);
  }
  // Facing any piece, the visible side of the world shows at least four kinds of experience.
  for (const panel of content) {
    const view = orientationFacing(panel.point, 90);
    const visible = new Set(content.filter((other) => facingDepth(other.point, view) > .25).map(tag));
    assert.ok(visible.size >= 4, `${panel.key}: ${[...visible]}`);
  }
  // Representatives stay on the equator, far from each other: choosing one is a short turn.
  const featured = specialties.map((specialty) => panels.find((panel) => panel.key === specialty.featured)!.point);
  for (const point of featured) assert.ok(Math.abs(point.lat) <= 40);
  // (Anchors snap to the nearest of 27 evenly spread points, ≈ 36° apart: never the same neighbourhood.)
  for (let a = 0; a < featured.length; a++) for (let b = a + 1; b < featured.length; b++) assert.ok(angularDistance(featured[a]!, featured[b]!) > 35);
});

test('el video del ritual abre el mundo: al frente, el más grande y sin piezas que lo tapen', () => {
  const { panels, initial, hero } = buildGlobe(services, local, clips);
  assert.equal(hero, 'ritual-toallas-calidas');
  const first = panels.find((panel) => panel.key === hero)!;
  assert.equal(first.kind, 'video');
  assert.equal(first.hero, true);
  assert.ok(first.video?.endsWith('.mp4'));
  assert.equal(first.specialtyId, undefined, 'the welcome belongs to every specialty');
  assert.ok(facingDepth(first.point, initial) > .99);
  assert.equal(first.shade, 0);
  assert.ok(panels.every((panel) => panel === first || panel.size < first.size), 'clear hierarchy');
  for (const panel of panels.filter((item) => item !== first && angularDistance(item.point, first.point) < 42)) assert.ok(panel.size <= .84, `${panel.key} stays small beside the clip`);
  // The second clip is a facial work placed behind: found again by turning.
  const second = panels.find((panel) => panel.key === 'limpieza-facial')!;
  assert.equal(second.kind, 'video');
  assert.equal(second.specialtyId, 'facial');
  assert.ok(facingDepth(second.point, initial) < -.5);
  assert.ok(Math.abs(second.point.lat) < 20);
});

test('Peluquería con trabajos reales; sin fotos, un emblema esmeralda y nunca una foto ajena', () => {
  const { panels, specialties } = buildGlobe(services, local, clips);
  const hair = specialties.find((specialty) => specialty.id === 'peluqueria')!;
  assert.equal(hair.works, true);
  assert.deepEqual(panels.filter((panel) => panel.specialtyId === 'peluqueria').map((panel) => panel.key).sort(), ['peluqueria-liso', 'peluqueria-rubio-ondas', 'peluqueria-rubio-texturizado']);
  // Without its photos (e.g. permissions), the emblem returns.
  const withoutHair = buildGlobe(services, local.filter((item: { category: string }) => item.category !== 'peluqueria'), clips);
  const own = withoutHair.panels.filter((panel) => panel.specialtyId === 'peluqueria');
  assert.deepEqual(own.map((panel) => [panel.kind, panel.image]), [['emblem', undefined]]);
  assert.match(own[0]!.caption, /^Pronto compartiremos fotografías de peluquería/);
});

test('build público con medios demo: el mismo globo que la vista local, con fotos y videos', () => {
  const build = buildGlobe(services, demoBuild, demoClips);
  const preview = buildGlobe(services, local, clips);
  assert.deepEqual(build.panels.map((panel) => panel.key), preview.panels.map((panel) => panel.key));
  assert.equal(build.panels.filter((panel) => panel.kind === 'video').length, 2);
  assert.ok(build.panels.filter((panel) => panel.image).length > 20);
});

test('build sin medios aprobados: un globo de emblemas y facetas, sin imágenes ni videos', () => {
  const { panels, specialties, hero } = buildGlobe(services, production, productionClips);
  assert.equal(hero, undefined);
  assert.equal(panels.filter((panel) => panel.kind === 'video').length, 0);
  assert.equal(panels.filter((panel) => panel.image).length, 0);
  assert.equal(panels.filter((panel) => panel.kind === 'emblem').length, 5);
  assert.ok(specialties.every((specialty) => specialty.featured.startsWith('emblem-')));
  assert.ok(panels.length >= 26);
});

test('sin videos, la foto de Barbería abre el globo con el sombreado estático coherente', () => {
  const { panels, initial } = buildGlobe(services, local);
  const featured = panels.find((panel) => panel.key === 'corte-peinado')!;
  assert.ok(facingDepth(featured.point, initial) > .99);
  assert.equal(featured.shade, 0);
  assert.ok(panels.some((panel) => facingDepth(panel.point, initial) < -.5), 'some pieces start behind');
});
