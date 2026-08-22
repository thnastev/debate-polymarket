/** Preview-only build. The shipped app uses the root vite.config.ts.
 *
 * src/lib/api.ts is swapped for an in-memory stand-in so the real components
 * and the real LMSR can be driven without a database.
 *
 * This is a resolveId plugin rather than a resolve.alias entry because alias
 * matches the raw import SPECIFIER — tradeQueue.ts imports './api', which
 * never matches an absolute path — whereas resolveId sees where that
 * specifier actually lands. Nothing here affects the production build.
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const REAL_API = fileURLToPath(new URL('../src/lib/api.ts', import.meta.url));
const MOCK_API = fileURLToPath(new URL('./mockApi.ts', import.meta.url));

function mockApi(): Plugin {
  return {
    name: 'preview-mock-api',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === MOCK_API || !importer) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && resolved.id === REAL_API) return MOCK_API;
      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [mockApi(), react()],
  // Keeps the real supabase client from pointing at http://localhost and
  // spamming connection errors in a preview that never talks to a server.
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://preview.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('preview'),
  },
  build: { outDir: '../dist-preview', emptyOutDir: true },
});
