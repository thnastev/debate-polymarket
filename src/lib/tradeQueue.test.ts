import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * §13: "Double-tapping the bet button creates exactly one bet."
 *
 * The mechanism is that the idempotency key is minted when the button is first
 * pressed, so both taps carry the same key and the server dedupes on it. These
 * tests pin that behaviour, plus the rule that a deliberate server rejection
 * is surfaced rather than retried forever.
 */
const placeBet = vi.fn();
vi.mock('./api', () => ({ placeBet: (...a: unknown[]) => placeBet(...a) }));

let mod: typeof import('./tradeQueue');

beforeEach(async () => {
  vi.resetModules();
  placeBet.mockReset();
  localStorage.clear();
  mod = await import('./tradeQueue');
});
afterEach(() => { vi.useRealTimers(); });

const trade = (id: string) => ({ id, marketId: 'm1', outcomeIdx: 0, stake: 25 });
const result = { ok: true, shares: 89.5, prices: [0.31, 0.23, 0.23, 0.23], balance_after: 975 };

describe('trade queue', () => {
  it('mints a distinct idempotency key each press', () => {
    const a = mod.newIdempotencyKey();
    const b = mod.newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it('sends the key it was given, so the server can dedupe on it', async () => {
    placeBet.mockResolvedValue(result);
    await mod.submitTrade(trade('key-1'));
    expect(placeBet).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1' }));
  });

  it('a double-tap reusing one key sends that key both times — one bet', async () => {
    placeBet.mockResolvedValue(result);
    // Both taps carry the key minted on the first press.
    await Promise.all([mod.submitTrade(trade('same-key')), mod.submitTrade(trade('same-key'))]);
    const keys = placeBet.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('same-key');
  });

  it('keeps a trade queued when the network fails, so it can be resent', async () => {
    placeBet.mockRejectedValue(new Error('Failed to fetch'));
    await expect(mod.submitTrade(trade('k2'))).rejects.toThrow();
    expect(mod.pendingFor('m1')).toHaveLength(1);
  });

  it('resends a queued trade with the SAME key on reconnect', async () => {
    placeBet.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(result);
    await expect(mod.submitTrade(trade('k3'))).rejects.toThrow();
    await mod.flushQueue();
    const keys = placeBet.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual(['k3', 'k3']);
    expect(mod.pendingFor('m1')).toHaveLength(0);
  });

  it('drops a trade the server rejected on purpose — retrying cannot fix it', async () => {
    placeBet.mockRejectedValue(new Error('insufficient_balance'));
    await expect(mod.submitTrade(trade('k4'))).rejects.toThrow(/insufficient_balance/);
    expect(mod.pendingFor('m1')).toHaveLength(0);
  });

  it('persists the queue, so closing the app mid-trade does not lose it', async () => {
    placeBet.mockRejectedValue(new Error('network timeout'));
    await expect(mod.submitTrade(trade('k5'))).rejects.toThrow();
    vi.resetModules();
    const reloaded = await import('./tradeQueue');
    expect(reloaded.pendingFor('m1').map((t) => t.id)).toEqual(['k5']);
  });
});
