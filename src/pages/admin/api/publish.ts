import type { APIRoute } from 'astro';
import { adminContext, handle, json } from '../../../server/http.ts';

export const prerender = false;

export const GET: APIRoute = () => handle(async () => json(await adminContext().publisher.describe()));

/** Retry after a failed publish (the previous release stayed online meanwhile). */
export const POST: APIRoute = () => handle(async () => {
  const { publisher } = adminContext();
  void publisher.request();
  return json(await publisher.describe(), 202);
});
