/**
 * Trades survive a bad corridor.
 *
 * The rule that matters (§9, §13): the idempotency key is generated when the
 * button is FIRST PRESSED, not when the request is sent. A double-tap reuses
 * the key of the trade already in flight, the server dedupes on it, and
 * exactly one bet exists no matter how many times the request goes out.
 *
 * Queued trades are persisted, so closing the app mid-trade does not lose it.
 */
import { placeBet } from './api';
import type { TradeResult } from './types';

const KEY = 'biser.queue.v1';

export interface QueuedTrade {
  id: string;                 // the idempotency key
  marketId: string;
  outcomeIdx: number;
  stake?: number;
  shares?: number;
  queuedAt: number;
  attempts: number;
}

type Listener = (queue: QueuedTrade[]) => void;

function load(): QueuedTrade[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function save(q: QueuedTrade[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* private mode */ }
}

let queue: QueuedTrade[] = load();
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l([...queue]));

export function subscribeQueue(l: Listener): () => void {
  listeners.add(l);
  l([...queue]);
  return () => { listeners.delete(l); };
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function pendingFor(marketId: string): QueuedTrade[] {
  return queue.filter((t) => t.marketId === marketId);
}

/**
 * Submit a trade. Resolves with the server's result, or throws if the failure
 * is one retrying cannot fix (a closed market, an insufficient balance). If
 * the failure looks like the network, the trade stays queued and this throws
 * an offline marker so the UI can show a pending state instead of an error.
 */
export async function submitTrade(t: Omit<QueuedTrade, 'queuedAt' | 'attempts'>): Promise<TradeResult> {
  if (!queue.some((x) => x.id === t.id)) {
    queue = [...queue, { ...t, queuedAt: Date.now(), attempts: 0 }];
    save(queue); notify();
  }
  return await attempt(t.id);
}

function isNetworkFailure(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /fetch|network|timeout|Failed to fetch|ECONN|502|503|504/i.test(m);
}

async function attempt(id: string): Promise<TradeResult> {
  const t = queue.find((x) => x.id === id);
  if (!t) throw new Error('trade_not_queued');
  t.attempts += 1;
  save(queue);
  try {
    const res = await placeBet({
      marketId: t.marketId, outcomeIdx: t.outcomeIdx,
      stake: t.stake, shares: t.shares, idempotencyKey: t.id,
    });
    dequeue(id);
    return res;
  } catch (e) {
    // A rejection the server made on purpose will be made again on every
    // retry, so drop it and surface it. Only transport failures stay queued.
    if (!isNetworkFailure(e)) { dequeue(id); throw e; }
    throw e;
  }
}

function dequeue(id: string) {
  queue = queue.filter((x) => x.id !== id);
  save(queue); notify();
}

/** Retry everything still queued, oldest first, with backoff between rounds. */
let flushing = false;
export async function flushQueue(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    for (const t of [...queue].sort((a, b) => a.queuedAt - b.queuedAt)) {
      try { await attempt(t.id); }
      catch { /* stays queued; the next flush will try again */ }
    }
  } finally { flushing = false; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushQueue(); });
  // A slow flap does not always fire 'online'; a gentle poll covers it.
  setInterval(() => { if (navigator.onLine && queue.length) void flushQueue(); }, 15000);
}
