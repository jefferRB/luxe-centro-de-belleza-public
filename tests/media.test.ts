import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  canShow, canUseMedia, canUseVideo, DEMO_MEDIA_DIR, DEMO_PERMISSION, isPublishable, isWork, mediaCatalog, receptionPhoto,
  showsDemoMedia, videoCatalog, workCategories, type MediaRecord, type VideoRecord,
} from '../src/data/media-catalog.ts';
import { services } from '../src/data/services.ts';

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** The same records as client media still under review: what the real site holds before approval. */
const underReview = <T extends MediaRecord | VideoRecord>(item: T): T => ({ ...item, permission: { status: 'local-preview' } });

test('inventory has stable unique identifiers, orders and real sources', () => {
  assert.equal(new Set(mediaCatalog.map((item) => item.id)).size, mediaCatalog.length);
  assert.equal(new Set(mediaCatalog.map((item) => item.order)).size, mediaCatalog.length);
  for (const item of mediaCatalog) {
    assert.ok(existsSync(item.source), item.source);
    assert.ok(item.alt.length > 25);
    assert.ok(item.caption.length > 0);
  }
});

test('reviewed visual classification: eight cuts, three hair styles, nine nails, one brow, two facial processes', () => {
  const works = mediaCatalog.filter(isWork);
  assert.deepEqual(Object.fromEntries(['cortes', 'peluqueria', 'unas', 'cejas', 'faciales'].map((category) => [category, works.filter((work) => work.category === category).length])), { cortes: 8, peluqueria: 3, unas: 9, cejas: 1, faciales: 2 });
  assert.equal(works.find((item) => item.id === 'facial-proceso')?.kind, 'process');
  assert.equal(works.find((item) => item.id === 'facial-aparatologia')?.kind, 'process');
  assert.equal(works.some((item) => item.kind === 'interior' || item.kind === 'promotion'), false);
});

// ---------------------------------------------------------------- publication policy

test('the public repository catalog is demo-only: generated files, labelled alt text, no client media', () => {
  for (const item of [...mediaCatalog, ...videoCatalog, receptionPhoto]) {
    assert.equal(item.permission.status, 'demo', item.source);
    assert.ok(item.source.startsWith(DEMO_MEDIA_DIR), item.source);
    assert.match(item.alt, /^(Ilustración|Video) de demostración/, item.source);
  }
  for (const video of videoCatalog) assert.ok(video.poster.startsWith(DEMO_MEDIA_DIR), video.poster);
  for (const item of mediaCatalog) if (item.thumbSource) assert.ok(item.thumbSource.startsWith(DEMO_MEDIA_DIR), item.thumbSource);
});

test('production builds ship demo media and say so; nothing else in this catalog is publishable', () => {
  assert.equal(mediaCatalog.filter((item) => canUseMedia(item, false)).length, 29);
  assert.equal(videoCatalog.filter((item) => canUseVideo(item, false)).length, 2);
  assert.equal(isPublishable(receptionPhoto.permission), true);
  assert.equal(showsDemoMedia(mediaCatalog), true);
});

test('client media under review appears only in `astro dev`, never in a build', () => {
  for (const item of mediaCatalog.map(underReview)) {
    assert.equal(canUseMedia(item, true), true, item.id);
    assert.equal(canUseMedia(item, false), false, item.id);
  }
  for (const video of videoCatalog.map(underReview)) {
    assert.equal(canUseVideo(video, true), true, video.id);
    assert.equal(canUseVideo(video, false), false, video.id);
  }
  assert.equal(canShow({ status: 'local-preview' }, false), false);
  assert.equal(showsDemoMedia(mediaCatalog.map(underReview)), false);
});

for (const status of ['pending', 'third-party'] as const) {
  test(`${status} media stays excluded in development and production`, () => {
    const item: MediaRecord = { ...mediaCatalog[0]!, permission: { status } };
    assert.equal(canUseMedia(item, true), false);
    assert.equal(canUseMedia(item, false), false);
  });
}

test('approval requires evidence and a review date', () => {
  const item: MediaRecord = { ...mediaCatalog[0]!, permission: { status: 'approved', evidence: 'Written owner approval and subject consent', reviewedAt: '2026-10-27' } };
  assert.equal(canUseMedia(item, false), true);
  assert.equal(canUseMedia({ ...item, permission: { status: 'approved', evidence: ' ', reviewedAt: '2026-10-27' } }, false), false);
  assert.equal(canUseMedia({ ...item, permission: { status: 'approved', evidence: 'record', reviewedAt: '' } }, false), false);
});

test('demo media requires provenance and a licence statement', () => {
  const item = mediaCatalog[0]!;
  assert.equal(canUseMedia({ ...item, permission: { ...DEMO_PERMISSION, provenance: ' ' } }, false), false);
  assert.equal(canUseMedia({ ...item, permission: { ...DEMO_PERMISSION, license: '' } }, false), false);
  assert.equal(canUseMedia({ ...item, permission: DEMO_PERMISSION }, false), true);
});

test('promotions remain excluded even if their publication permission changes', () => {
  const promo: MediaRecord = { ...mediaCatalog[0]!, id: 'promo', category: 'promocional', kind: 'promotion' };
  for (const permission of [DEMO_PERMISSION, { status: 'approved', evidence: 'example', reviewedAt: '2026-10-27' } as const]) {
    assert.equal(canUseMedia({ ...promo, permission }, true), false);
    assert.equal(canUseMedia({ ...promo, permission }, false), false);
  }
});

test('service groups map to the shared work taxonomy, never promotional media', () => {
  const expected: Record<string, string> = { barberia: 'cortes', peluqueria: 'peluqueria', 'unas-pedicura': 'unas', cejas: 'cejas', facial: 'faciales' };
  assert.equal(new Set(services.map((service) => service.id)).size, services.length);
  for (const service of services) {
    assert.equal(service.category, expected[service.id]);
    assert.ok(Object.hasOwn(workCategories, service.category));
  }
  assert.equal(services.some((service) => (service.category as string) === 'promocional'), false);
});

// ---------------------------------------------------------------- structure of the catalog

test('ninguna imagen se cataloga dos veces, ni siquiera con otro nombre', () => {
  const hashes = [...mediaCatalog.map((item) => sha(item.source)), sha(receptionPhoto.source)];
  assert.equal(new Set(hashes).size, hashes.length);
});

test('espacios y fachada: nunca trabajos ni promociones', () => {
  for (const id of ['estaciones', 'salon', 'espera', 'barberia-perspectiva', 'manicura', 'fachada']) {
    const item = mediaCatalog.find((entry) => entry.id === id)!;
    assert.equal(item.category, 'espacio');
    assert.ok(item.source.startsWith(`${DEMO_MEDIA_DIR}spaces/`));
    assert.equal(isWork(item), false);
  }
  assert.equal(mediaCatalog.find((entry) => entry.id === 'fachada')!.kind, 'exterior');
});

test('cinco trabajos con su variante liviana para el globo, nunca en el recorrido del local', () => {
  const expected: Record<string, string> = { 'corte-fade-perfil': 'cortes', 'barba-trabajo': 'cortes', 'unas-borgona': 'unas', 'peluqueria-rubio-ondas': 'peluqueria', 'peluqueria-liso': 'peluqueria' };
  for (const [id, category] of Object.entries(expected)) {
    const item = mediaCatalog.find((entry) => entry.id === id)!;
    assert.equal(item.category, category, id);
    assert.ok(isWork(item) && item.kind === 'result', id);
    assert.ok(item.thumbSource && item.thumbSource.endsWith('-globo.webp') && existsSync(item.thumbSource), id);
    assert.notEqual(sha(item.thumbSource!), sha(item.source));
    assert.ok(item.objectPosition, `${id} has an explicit framing`);
  }
  assert.equal(mediaCatalog.filter((item) => item.thumbSource).length, 5);
});

test('trabajos del Mundo LUXE: en sus categorías y con punto focal', () => {
  const expected: Record<string, string> = {
    'barberia-perfil-barba': 'cortes', 'peluqueria-rubio-texturizado': 'peluqueria', 'unas-vino-animal-print': 'unas', 'unas-grafico': 'unas',
    'unas-francesa-flores': 'unas', 'facial-aparatologia': 'faciales', 'unas-dorado-puntos': 'unas', 'unas-azul-animal-print': 'unas',
  };
  for (const [id, category] of Object.entries(expected)) {
    const item = mediaCatalog.find((entry) => entry.id === id)!;
    assert.equal(item.category, category, id);
    assert.ok(isWork(item), id);
    assert.ok(item.objectPosition, `${id} has a focal point for fixed frames`);
  }
});

test('videos del Mundo LUXE: con portada, uno solo destacado y la misma política de publicación', () => {
  assert.equal(new Set(videoCatalog.map((video) => video.id)).size, videoCatalog.length);
  assert.deepEqual(videoCatalog.filter((video) => video.featured).map((video) => video.id), ['ritual-toallas-calidas']);
  for (const video of videoCatalog) {
    assert.ok(existsSync(video.source) && /\.(webm|mp4)$/.test(video.source), video.source);
    assert.ok(existsSync(video.poster) && video.poster.endsWith('.webp'), video.poster);
    assert.ok(video.alt.startsWith('Video') && video.alt.length > 40);
    // Copy names only what the footage shows: no steam, massage or results.
    assert.doesNotMatch(`${video.title} ${video.alt} ${video.caption}`, /vapor|masaje|resultado|garantiz|elimina/i);
    assert.equal(canUseVideo(video, false), isPublishable(video.permission));
  }
  assert.equal(videoCatalog.find((video) => video.id === 'limpieza-facial')!.category, 'faciales');
});
