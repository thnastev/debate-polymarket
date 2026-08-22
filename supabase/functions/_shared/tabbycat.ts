/**
 * Tabbycat REST client. Server-side only.
 *
 * The endpoint SHAPES below are the expected shape, not gospel — confirm them
 * against the target instance's own schema browser at /api/schema/redoc/
 * before trusting them for a new tournament (§8).
 *
 * Be a good citizen: Tabbycat is volunteer-built and Calico hosts at cost.
 * Never poll faster than 20s, cache with ETags, and NEVER issue a POST, PATCH
 * or DELETE to a tab site under any circumstances — writing to a live
 * tournament's tab would be catastrophic. This module has no write method at
 * all, which is the cheapest way to keep that promise.
 */

const MIN_INTERVAL_MS = 20_000;
let lastRequestAt = 0;

const etags = new Map<string, string>();
const cache = new Map<string, unknown>();

export interface TabConfig {
  baseUrl: string;   // https://sofiaopen.calicotab.com
  slug: string;      // open
  token?: string;    // admin API token, if the tab director issued one
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function get<T>(cfg: TabConfig, path: string): Promise<T> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/tournaments/${cfg.slug}${path}`;
  await throttle();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cfg.token) headers.Authorization = `Token ${cfg.token}`;
  const prev = etags.get(url);
  if (prev) headers['If-None-Match'] = prev;

  const res = await fetch(url, { method: 'GET', headers });

  // 304: nothing changed. Serving the cached copy is the point of sending the
  // ETag, and it costs the tab nothing.
  if (res.status === 304 && cache.has(url)) return cache.get(url) as T;
  if (res.status === 401 || res.status === 403) {
    throw new Error(`tab_forbidden: ${path} is not public on this tournament`);
  }
  if (!res.ok) throw new Error(`tab_http_${res.status}: ${path}`);

  const tag = res.headers.get('etag');
  const body = await res.json();
  if (tag) { etags.set(url, tag); cache.set(url, body); }
  return body as T;
}

export const getTournament = (c: TabConfig) => get<Record<string, unknown>>(c, '');
export const getTeams = (c: TabConfig) => get<unknown[]>(c, '/teams');
export const getRounds = (c: TabConfig) => get<unknown[]>(c, '/rounds');
export const getPairings = (c: TabConfig, seq: number) =>
  get<unknown[]>(c, `/rounds/${seq}/pairings`);
export const getBallots = (c: TabConfig, seq: number, debateId: string) =>
  get<unknown[]>(c, `/rounds/${seq}/pairings/${debateId}/ballots`);
