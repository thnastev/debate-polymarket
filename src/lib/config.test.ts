import { describe, it, expect } from 'vitest';

/**
 * config.ts reads window.BISER_CONFIG once at module load, so each case needs a
 * fresh module. The placeholder rule is what decides whether a freshly
 * uploaded site shows the setup screen or tries to talk to nothing, so it is
 * worth pinning: an earlier version used /^(|PASTE_...)/, whose empty first
 * alternative matches every string, and no configuration was ever accepted.
 */
async function withConfig(cfg: unknown) {
  const { vi } = await import('vitest');
  vi.resetModules();
  (globalThis as { window?: unknown }).window = { BISER_CONFIG: cfg };
  return import('./config');
}

describe('runtime configuration', () => {
  it('accepts real Supabase details', async () => {
    const m = await withConfig({
      supabaseUrl: 'https://abcdefgh.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def',
    });
    expect(m.configured).toBe(true);
    expect(m.supabaseUrl).toBe('https://abcdefgh.supabase.co');
  });

  it('treats the shipped placeholders as unconfigured', async () => {
    const m = await withConfig({
      supabaseUrl: 'PASTE_YOUR_SUPABASE_URL_HERE',
      supabaseAnonKey: 'PASTE_YOUR_ANON_KEY_HERE',
    });
    expect(m.configured).toBe(false);
  });

  it('treats blanks and whitespace as unconfigured', async () => {
    expect((await withConfig({ supabaseUrl: '', supabaseAnonKey: '' })).configured).toBe(false);
    expect((await withConfig({ supabaseUrl: '   ', supabaseAnonKey: '  ' })).configured).toBe(false);
    expect((await withConfig(undefined)).configured).toBe(false);
  });

  it('needs BOTH values, not one', async () => {
    expect((await withConfig({
      supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'PASTE_YOUR_ANON_KEY_HERE',
    })).configured).toBe(false);
    expect((await withConfig({
      supabaseUrl: 'PASTE_YOUR_SUPABASE_URL_HERE', supabaseAnonKey: 'eyJ.abc',
    })).configured).toBe(false);
  });

  it('trims stray whitespace from a pasted value', async () => {
    const m = await withConfig({
      supabaseUrl: '  https://abc.supabase.co  ', supabaseAnonKey: ' eyJ.abc ',
    });
    expect(m.supabaseUrl).toBe('https://abc.supabase.co');
    expect(m.configured).toBe(true);
  });

  it('rejects an angle-bracket placeholder someone typed by hand', async () => {
    expect((await withConfig({
      supabaseUrl: '<your project url>', supabaseAnonKey: '<key>',
    })).configured).toBe(false);
  });
});
