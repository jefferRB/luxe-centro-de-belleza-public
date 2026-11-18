import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleMapsShareLink, instagramProfileLink, wazeShareLink, whatsappChatLink } from '../src/lib/public-links.ts';
import { outboundAllowlist, publicLinks, resolvePublicLinks } from '../src/data/links.ts';
import { luxe, type LuxeConfig } from '../src/data/luxe.ts';

test('los enlaces públicos confirmados son exactamente los del brief', () => {
  assert.deepEqual(publicLinks, {
    booking: 'https://www.dragocr.com/reservar/luxecentrobelleza',
    whatsapp: 'https://wa.me/50671620752',
    instagram: 'https://www.instagram.com/luxe_centrodebelleza/',
    instagramHandle: 'luxe_centrodebelleza',
    maps: 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6',
    waze: 'https://waze.com/ul/hd1u22w6m3',
  });
  assert.deepEqual([...outboundAllowlist].sort(), [publicLinks.booking, publicLinks.whatsapp, publicLinks.instagram, publicLinks.maps, publicLinks.waze].sort());
});

test('cada canal confirmado conserva fuente y fecha de revisión', () => {
  for (const entry of [luxe.contact.whatsapp, luxe.contact.instagram, luxe.contact.maps, luxe.contact.waze, luxe.contact.address, luxe.contact.hours]) {
    assert.equal(entry.status, 'confirmed');
    assert.ok(entry.source.trim().length > 0);
    assert.match(entry.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('un dato pendiente nunca produce un enlace', () => {
  const pending: LuxeConfig = {
    ...luxe,
    contact: { whatsapp: { status: 'pending' }, instagram: { status: 'pending' }, maps: { status: 'pending' }, waze: { status: 'pending' }, address: { status: 'pending' }, hours: { status: 'pending' } },
    drago: { slug: luxe.drago.slug, modules: { ...luxe.drago.modules, reservar: { status: 'pending' } } },
  };
  assert.deepEqual(resolvePublicLinks(pending), { booking: undefined, whatsapp: undefined, instagram: undefined, instagramHandle: undefined, maps: undefined, waze: undefined });
});

test('no se construyen reservas con fidelidad u opiniones pendientes', () => {
  assert.ok(!outboundAllowlist.some((link) => /\/(fidelidad|opinar)\//.test(link)));
});

for (const phone of ['', '0', '+50671620752', '506 7162 0752', '506-71620752', '5067162075a', '0050671620752', '1234567', '1'.repeat(16), '50671620752?text=hola', '50671620752/../x']) {
  test(`WhatsApp rechaza ${JSON.stringify(phone)}`, () => assert.throws(() => whatsappChatLink(phone), TypeError));
}
for (const handle of ['', '.luxe', 'luxe.', 'lu..xe', 'Luxe', 'luxe/admin', 'luxe?x=1', 'a'.repeat(31), 'luxe centro', '@luxe']) {
  test(`Instagram rechaza ${JSON.stringify(handle)}`, () => assert.throws(() => instagramProfileLink(handle), TypeError));
}
for (const url of ['http://maps.app.goo.gl/z7ss3mpVHJqMxDbe6', 'https://maps.app.goo.gl.evil.test/z7ss3mpVHJqMxDbe6', 'https://evil.test/?u=https://maps.app.goo.gl/x', 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6?q=1', 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6#x', 'https://user@maps.app.goo.gl/z7ss3mpVHJqMxDbe6', 'https://maps.app.goo.gl:444/z7ss3mpVHJqMxDbe6', 'https://maps.app.goo.gl/', 'https://maps.app.goo.gl/a/b', 'javascript:alert(1)', 'not a url']) {
  test(`Maps rechaza ${url}`, () => assert.throws(() => googleMapsShareLink(url), TypeError));
}
for (const url of ['http://waze.com/ul/hd1u22w6m3', 'https://waze.com.evil.test/ul/hd1u22w6m3', 'https://www.waze.com/ul/hd1u22w6m3', 'https://waze.com/ul/hd1u22w6m3?x=1', 'https://waze.com/ul/hd1u22w6m3#a', 'https://waze.com/live-map?ll=9.9,-83.9', 'https://waze.com/ul/', 'https://waze.com/ul/HD1U22W6M3', 'https://user@waze.com/ul/hd1u22w6m3', 'javascript:alert(1)']) {
  test(`Waze rechaza ${url}`, () => assert.throws(() => wazeShareLink(url), TypeError));
}
test('constructores aceptan los valores confirmados', () => {
  assert.equal(wazeShareLink('https://waze.com/ul/hd1u22w6m3'), 'https://waze.com/ul/hd1u22w6m3');
  assert.equal(whatsappChatLink('50671620752'), 'https://wa.me/50671620752');
  assert.equal(instagramProfileLink('luxe_centrodebelleza'), 'https://www.instagram.com/luxe_centrodebelleza/');
  assert.equal(googleMapsShareLink('https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6'), 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6');
});
