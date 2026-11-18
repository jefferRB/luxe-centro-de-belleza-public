import type { APIRoute } from 'astro';
import { luxe } from '../data/luxe';

/** The site is one public page; the admin is never listed. Generated at build time. */
export const prerender = true;

export const GET: APIRoute = () => {
  if (luxe.canonicalOrigin.status !== 'confirmed') return new Response(null, { status: 404 });
  const home = new URL('/', luxe.canonicalOrigin.value).href;
  const lastmod = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${home}</loc><lastmod>${lastmod}</lastmod></url>\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
