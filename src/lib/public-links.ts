/** Outbound contact links built from allowlisted hosts and validated identifiers.
 * Like drago.ts, syntax checks never prove ownership: values must be confirmed in luxe.ts. */

/** International number, digits only (E.164 without "+"), as wa.me expects. */
export function whatsappChatLink(phone: string): string {
  if (typeof phone !== 'string' || !/^[1-9]\d{7,14}$/.test(phone)) {
    throw new TypeError('Número de WhatsApp no válido');
  }
  return `https://wa.me/${phone}`;
}

export function instagramProfileLink(handle: string): string {
  if (typeof handle !== 'string' || !/^(?!\.)(?!.*\.\.)[a-z0-9._]{1,30}(?<!\.)$/.test(handle)) {
    throw new TypeError('Usuario de Instagram no válido');
  }
  return `https://www.instagram.com/${handle}/`;
}

/** Only official Google Maps share links: no redirects, credentials or query data. */
export function googleMapsShareLink(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('Enlace de Google Maps no válido'); }
  if (url.protocol !== 'https:' || url.hostname !== 'maps.app.goo.gl' || url.port || url.username ||
      url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]{6,64}$/.test(url.pathname)) {
    throw new TypeError('Enlace de Google Maps no válido');
  }
  return url.href;
}

/** Only Waze share links (waze.com/ul/<geohash>), exactly as the owner provides them. */
export function wazeShareLink(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('Enlace de Waze no válido'); }
  if (url.protocol !== 'https:' || url.hostname !== 'waze.com' || url.port || url.username ||
      url.password || url.search || url.hash || !/^\/ul\/[0-9a-z]{6,24}$/.test(url.pathname)) {
    throw new TypeError('Enlace de Waze no válido');
  }
  return url.href;
}
