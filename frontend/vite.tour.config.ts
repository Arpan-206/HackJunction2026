import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The public tour build (docs/PUBLIC_TOUR.md): `npx vite build --config vite.tour.config.ts`. A separate entry
 * (tour.html, src/tour/) that runs entirely in the browser from bundled recordings. The normal app build
 * (vite.config.ts) is untouched. The base is relative, so the same files work at the root of a host and under
 * /<repo>/ on a GitHub Pages project site; the tour's own hash routing means a reload never 404s.
 *
 * No env value reaches this bundle: envPrefix is a name no variable has, and the tour reads no import.meta.env key
 * except Vite's own BASE_URL, MODE, DEV and PROD.
 */
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'dist-tour');

/** The app's public files the tour draws with: the hand mesh, the Dex3-1 URDFs and the wood texture of the learner's hand. */
const APP_ASSETS = ['models/hands', 'models/robots', 'textures/wood'];
/** The push-recovery clip (robot_policy/, on main). */
const VIDEO = resolve(here, '../robot_policy/out/policy_demo.mp4');

function tourFiles(): Plugin {
  return {
    name: 'geppetto-tour-files',
    apply: 'build',
    writeBundle() {
      for (const dir of APP_ASSETS) cpSync(resolve(here, 'public', dir), resolve(OUT, dir), { recursive: true });
      if (existsSync(VIDEO)) {
        mkdirSync(resolve(OUT, 'media'), { recursive: true });
        cpSync(VIDEO, resolve(OUT, 'media/policy_demo.mp4'));
      }
      // The entry is tour.html in the source tree; the site serves it as index.html.
      const html = resolve(OUT, 'tour.html');
      if (existsSync(html)) renameSync(html, resolve(OUT, 'index.html'));
    },
  };
}

export default defineConfig({
  base: './',
  envPrefix: 'GEPPETTO_TOUR_NO_ENV_',
  publicDir: resolve(here, 'tour/public'),
  plugins: [react(), tourFiles()],
  resolve: {
    preserveSymlinks: true,
    // The live hand's delay probe can call the core on :8765; the tour has no core, so it gets a stub that does nothing.
    alias: [{ find: /^.*\/api\/delayProbe$/, replacement: resolve(here, 'src/tour/stubs/delayProbe.ts') }],
  },
  define: {
    // Belt and braces: the app's mock and kiosk flags read these; the tour never imports those modules.
    'import.meta.env.VITE_MOCK': JSON.stringify('1'),
    'import.meta.env.VITE_KIOSK': JSON.stringify(''),
    'import.meta.env.VITE_DEV_PANEL': JSON.stringify(''),
  },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: resolve(here, 'tour.html') },
  },
});
