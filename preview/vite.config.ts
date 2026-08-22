/** Preview-only build. The shipped app uses the root vite.config.ts. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: '../dist-preview', emptyOutDir: true },
});
