import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragoPublicLink, type DragoRoute } from '../src/lib/drago.ts';
import { luxe } from '../src/data/luxe.ts';

for (const kind of ['reservar', 'fidelidad', 'opinar'] as const) {
  test(`Construye ${kind} exclusivamente en el origen oficial`, () => {
    for (const slug of ['negocio', 'negocio-123', 'a', 'a'.repeat(63)]) {
      const url = new URL(dragoPublicLink(kind, slug));
      assert.equal(url.origin, 'https://www.dragocr.com');
      assert.equal(url.pathname, `/${kind}/${slug}`);
      assert.equal(url.search, '');
      assert.equal(url.hash, '');
      assert.equal(url.username, '');
    }
  });
}
const badSlugs: unknown[] = ['', ' ', ' Negocio', 'NEGOCIO', 'negocio ', 'a\n', 'a\r\n', '../admin', '.', '..', '/admin', '//evil.test', 'https://evil.test', 'a/b', 'a\\b', 'a%2fb', '%252e%252e', 'a?telefono=123', 'a#token', 'a@evil.test', 'a_b', '-a', 'a-', 'a--b', 'ñ', 'а', 'a\0b', 'a'.repeat(64), null, undefined, 123, {}, ['negocio']];
for (const [index, slug] of badSlugs.entries()) {
  test(`Rechaza slug inválido #${index + 1}`, () => {
    assert.throws(() => dragoPublicLink('reservar', slug as string), TypeError);
  });
}
for (const kind of ['admin', '../reservar', 'reservar/', 'Reservar', 'toString', '__proto__', 'https://evil.test', '', null, 1, {}]) {
  test(`Rechaza ruta fuera de allowlist: ${String(kind)}`, () => {
    assert.throws(() => dragoPublicLink(kind as DragoRoute, 'negocio'), TypeError);
  });
}
test('Las integraciones y datos no confirmados permanecen pendientes', () => {
  // Fase 3.2 confirmed booking; Fase 4 confirmed address (locality level) and hours. The rest stays pending.
  assert.equal(luxe.drago.modules.fidelidad.status, 'pending');
  assert.equal(luxe.drago.modules.opinar.status, 'pending');
  assert.equal(luxe.mediaPermission.status, 'pending');
  // Brief SEO (2026-11-09): the canonical domain is confirmed, with www and HTTPS.
  assert.equal(luxe.canonicalOrigin.status, 'confirmed');
  assert.equal(luxe.canonicalOrigin.status === 'confirmed' && luxe.canonicalOrigin.value, 'https://www.luxecentrobelleza.com');
});
test('El slug confirmado de reservas produce la URL oficial exacta', () => {
  assert.equal(luxe.drago.slug.status, 'confirmed');
  assert.equal(luxe.drago.modules.reservar.status, 'confirmed');
  assert.equal(dragoPublicLink('reservar', luxe.drago.slug.value), 'https://www.dragocr.com/reservar/luxecentrobelleza');
  for (const entry of [luxe.drago.slug, luxe.drago.modules.reservar]) {
    assert.ok(entry.source.trim().length > 0);
    assert.match(entry.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});
