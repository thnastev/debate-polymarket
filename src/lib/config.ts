/**
 * Where the Supabase connection details come from.
 *
 * A Vite build normally inlines `import.meta.env.VITE_*` at BUILD time, which
 * would tie a built folder to whoever built it. This site is meant to be
 * downloadable and uploadable as-is, so config is read at RUNTIME from
 * `config.js` — a plain file sitting next to index.html that the operator
 * edits with two values. Build-time env still works and wins nothing; it is
 * the fallback for `npm run dev`.
 *
 * The anon key belongs in a public file. Every rule that protects money is
 * enforced by RLS and the security definer functions in the database; the key
 * only says which project to talk to.
 */
declare global {
  interface Window {
    BISER_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  }
}

// An empty alternative here — /^(|PASTE_...)/ — matches at position 0 of every
// string, so every value would read as a placeholder and the site would never
// configure itself. Keep the alternatives non-empty and test emptiness apart.
const PLACEHOLDER = /^(PASTE_[A-Z_]*|your-|https:\/\/your-project|<.*>)/i;

function clean(v: string | undefined | null): string {
  const s = (v ?? '').trim();
  if (s.length === 0) return '';
  if (PLACEHOLDER.test(s)) return '';
  return s;
}

const runtime = typeof window !== 'undefined' ? window.BISER_CONFIG : undefined;

export const supabaseUrl =
  clean(runtime?.supabaseUrl) || clean(import.meta.env.VITE_SUPABASE_URL);
export const supabaseAnonKey =
  clean(runtime?.supabaseAnonKey) || clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

export const configured = Boolean(supabaseUrl && supabaseAnonKey);

/** Which file the operator needs to edit, phrased for whoever is looking. */
export const configHint = typeof runtime === 'undefined'
  ? 'config.js is missing from the uploaded folder.'
  : 'config.js is there, but still has its placeholder values in it.';
