import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ImageMetadata } from 'astro';
import sharp from 'sharp';
import { canUseMedia, mediaCatalog } from '../src/data/media-catalog.ts';
import { services } from '../src/data/services.ts';
import { spaceTour } from '../src/data/spaces.ts';
import { buildGlobe } from '../src/data/globe.ts';
import { activeUploads, emptyManifest, ManifestError, parseManifest, type MediaManifest, type UploadRef } from '../src/lib/media-manifest.ts';
import { applyManifest, resolveServiceGroups, resolveSpaceStops } from '../src/lib/media-resolve.ts';
import { ImageRejected, processUpload, sniffFormat } from '../src/server/image-intake.ts';
import { MediaStore } from '../src/server/media-store.ts';
import { addPhoto, editText, OperationError, replacePhoto, restorePhoto, retirePhoto, setGlobe, setOrder, siteModel } from '../src/server/photo-model.ts';

const ref = (n: number): UploadRef => ({ file: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000.webp`, width: 1200, height: 1500 });
const fake = (src: string): ImageMetadata => ({ src, width: 800, height: 1000, format: 'webp' });
const base = mediaCatalog.filter((item) => canUseMedia(item, false)).map((item) => ({ ...item, image: fake(`/${item.id}.webp`), thumb: item.thumbSource ? fake(`/${item.id}-globo.webp`) : undefined }));
const imageFor = (upload: UploadRef) => fake(`/uploads/${upload.file}`);

test('manifest: an empty manifest reproduces the curated site exactly', () => {
  const resolved = applyManifest(base, emptyManifest(), imageFor);
  assert.deepEqual(resolved.map((item) => [item.id, item.order, item.image.src]), base.map((item) => [item.id, item.order, item.image.src] as const).sort((a, b) => a[1] - b[1]));
  assert.deepEqual(resolveSpaceStops(spaceTour, emptyManifest()), [...spaceTour]);
  assert.deepEqual(resolveServiceGroups(services, emptyManifest()), [...services]);
});

test('manifest: strict parsing rejects unsafe ids, files, texts and shapes', () => {
  const valid = { ...emptyManifest(), revision: 1, updatedAt: new Date().toISOString() };
  assert.doesNotThrow(() => parseManifest(valid));
  assert.throws(() => parseManifest({ ...valid, version: 2 }), ManifestError);
  assert.throws(() => parseManifest({ ...valid, edits: { '../etc': { alt: 'Una descripción' } } }), ManifestError);
  assert.throws(() => parseManifest({ ...valid, edits: { salon: { replacement: { file: '../../x.webp', width: 1, height: 1 } } } }), ManifestError);
  assert.throws(() => parseManifest({ ...valid, edits: { salon: { alt: '<script>alert(1)</script>' } } }), ManifestError);
  assert.throws(() => parseManifest({ ...valid, globe: { barberia: ['a', 'b', 'c', 'd', 'e'] } }), ManifestError);
  assert.throws(() => parseManifest({ ...valid, order: { trabajos: ['a', 'a'] } }), ManifestError);
});

test('replace keeps the id (globe, crown and tour positions) and drops tuned framing', () => {
  const manifest = replacePhoto(emptyManifest(), 'corte-peinado', ref(1), 'Corte nuevo visto de perfil con degradado.');
  const resolved = applyManifest(base, manifest, imageFor);
  const photo = resolved.find((item) => item.id === 'corte-peinado')!;
  assert.equal(photo.image.src, `/uploads/${ref(1).file}`);
  assert.equal(photo.alt, 'Corte nuevo visto de perfil con degradado.');
  assert.equal(photo.objectPosition, undefined);
  assert.equal(photo.replaced, true);
  const before = buildGlobe(services, applyManifest(base, emptyManifest(), imageFor));
  const after = buildGlobe(resolveServiceGroups(services, manifest), resolved);
  assert.deepEqual(after.panels.map((panel) => [panel.key, panel.point]), before.panels.map((panel) => [panel.key, panel.point]), 'Same pieces in the same places');
  assert.equal(resolveServiceGroups(services, manifest).find((group) => group.id === 'barberia')!.focus, undefined);
  assert.deepEqual(activeUploads(manifest), [ref(1)]);
});

test('retire, restore, upload and order follow each section rules', () => {
  let manifest = retirePhoto(emptyManifest(), 'unas-rosa');
  assert.ok(!applyManifest(base, manifest, imageFor).some((item) => item.id === 'unas-rosa'));
  assert.throws(() => retirePhoto(manifest, 'unas-rosa'), OperationError);
  manifest = restorePhoto(manifest, 'unas-rosa');
  assert.ok(applyManifest(base, manifest, imageFor).some((item) => item.id === 'unas-rosa'));

  assert.throws(() => retirePhoto(emptyManifest(), 'fachada'), /reemplazarla/);
  assert.throws(() => retirePhoto(emptyManifest(), 'recepcion'), /reemplazarla/);
  // The 3D tour keeps at least two rooms.
  let rooms = emptyManifest();
  for (const id of ['estaciones', 'barberia-perspectiva', 'salon']) rooms = retirePhoto(rooms, id);
  assert.throws(() => retirePhoto(rooms, 'manicura'), /al menos 2/);

  manifest = addPhoto(emptyManifest(), { section: 'trabajos', category: 'unas', alt: 'Uñas cortas en tono nude con brillo.', title: 'Nude con brillo' }, ref(2), 'subida-0000aaaa-0000', new Date('2026-11-09T12:00:00Z'));
  const work = applyManifest(base, manifest, imageFor).find((item) => item.id === 'subida-0000aaaa-0000')!;
  assert.equal(work.category, 'unas');
  assert.deepEqual(work.copy, { title: 'Nude con brillo.', description: 'Uñas cortas en tono nude con brillo.' });
  assert.throws(() => addPhoto(emptyManifest(), { section: 'trabajos', category: 'otra', alt: 'Descripción válida', title: 'Título' }, ref(3), 'subida-x'), OperationError);
  assert.throws(() => addPhoto(emptyManifest(), { section: 'portada', alt: 'Descripción válida', title: 'Título' }, ref(3), 'subida-x'), OperationError);

  const works = siteModel(manifest).sections.trabajos.filter((photo) => !photo.removed).map((photo) => photo.id);
  const reversed = [...works].reverse();
  manifest = setOrder(manifest, 'trabajos', reversed);
  const ordered = applyManifest(base, manifest, imageFor).filter((item) => item.category !== 'espacio').map((item) => item.id);
  assert.deepEqual(ordered, reversed);
  assert.throws(() => setOrder(manifest, 'trabajos', reversed.slice(1)), OperationError);
  assert.throws(() => setOrder(manifest, 'portada', []), OperationError);
});

test('Mundo LUXE selection: only published works of the specialty, at most four', () => {
  const manifest = setGlobe(emptyManifest(), 'peluqueria', ['peluqueria-liso', 'peluqueria-rubio-ondas']);
  const groups = resolveServiceGroups(services, manifest);
  assert.deepEqual(groups.find((group) => group.id === 'peluqueria')!.globe, ['peluqueria-liso', 'peluqueria-rubio-ondas']);
  const globe = buildGlobe(groups, applyManifest(base, manifest, imageFor));
  assert.equal(globe.specialties.find((specialty) => specialty.id === 'peluqueria')!.featured, 'peluqueria-liso');
  assert.throws(() => setGlobe(emptyManifest(), 'peluqueria', ['unas-flores']), OperationError);
  assert.throws(() => setGlobe(emptyManifest(), 'unas-pedicura', ['unas-flores', 'unas-azul', 'unas-rosa', 'unas-grafico', 'unas-borgona']), OperationError);
  // Retiring a selected work also removes it from the globe selection.
  const retired = retirePhoto(manifest, 'peluqueria-liso');
  assert.deepEqual(retired.globe.peluqueria, ['peluqueria-rubio-ondas']);
});

test('texts are validated and only uploads have editable titles', () => {
  assert.throws(() => editText(emptyManifest(), 'salon', { alt: 'corta' }), /al menos/);
  const edited = editText(emptyManifest(), 'salon', { alt: 'Estación con espejo orgánico y paredes verdes.', title: 'Ignorado' });
  assert.equal(edited.edits.salon!.alt, 'Estación con espejo orgánico y paredes verdes.');
  assert.equal(edited.edits.salon!.title, undefined);
  assert.throws(() => editText(emptyManifest(), 'no-existe', { alt: 'Una descripción válida' }), OperationError);
});

test('uploads: real format from the bytes, size limits, re-encoded WebP without metadata', async () => {
  const jpeg = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#103d32' } }).jpeg().withExif({ IFD0: { Copyright: 'secreto' } }).toBuffer();
  const result = await processUpload(jpeg);
  assert.equal(sniffFormat(result.data), 'webp');
  assert.deepEqual([result.width, result.height], [900, 1200]);
  assert.equal((await sharp(result.data).metadata()).exif, undefined, 'EXIF/GPS stripped');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><script>alert(1)</script></svg>');
  await assert.rejects(processUpload(svg), ImageRejected);
  const gif = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#000' } }).gif().toBuffer();
  await assert.rejects(processUpload(gif), ImageRejected);
  await assert.rejects(processUpload(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<html>not an image</html>')])), ImageRejected);
  const tiny = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(processUpload(tiny), /muy pequeña/);
  await assert.rejects(processUpload(new Uint8Array(16 * 1024 * 1024)), /15 MB/);
  // A PNG renamed as JPEG is judged by its bytes (PNG is allowed); a PNG claiming to be WebP is not possible to fake.
  const png = await sharp({ create: { width: 800, height: 800, channels: 4, background: '#c5a36a' } }).png().toBuffer();
  assert.equal(sniffFormat(png), 'png');
});

test('store: atomic writes, revision conflicts, backups and immutable uploads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxe-media-'));
  try {
    const store = new MediaStore(dir);
    assert.equal((await store.read()).revision, 0);
    const first = await store.update(0, (current) => retirePhoto(current, 'unas-rosa'));
    assert.equal(first.revision, 1);
    await assert.rejects(store.update(0, (current) => restorePhoto(current, 'unas-rosa')), /otro cambio/);
    // A failed change leaves the stored manifest untouched.
    await assert.rejects(store.update(1, (current) => retirePhoto(current, 'fachada')), OperationError);
    assert.equal((await store.read()).revision, 1);
    await store.update(1, (current) => restorePhoto(current, 'unas-rosa'));
    assert.equal((await readdir(join(dir, 'backups'))).length, 1, 'Previous manifest backed up');
    const image = await processUpload(await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#123' } }).jpeg().toBuffer());
    const upload = await store.saveUpload(image);
    assert.match(upload.file, /^[0-9a-f-]{36}\.webp$/);
    assert.deepEqual(await readFile(store.uploadPath(upload.file)), image.data);
    assert.throws(() => store.uploadPath('../manifest.json'), OperationError);
    assert.ok(!(await readdir(dir)).some((name) => name.endsWith('.tmp')), 'No temp files left');
    const parsed: MediaManifest = parseManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
    assert.equal(parsed.revision, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
