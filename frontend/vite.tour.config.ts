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
/** Explore mode (explore.html) runs the whole app, which draws with every file in public/. They load only on its screens. */
const EXPLORE_ASSETS = ['models', 'textures', 'stills'];
/** The push-recovery clip (robot_policy/, on main). */
const VIDEO = resolve(here, '../robot_policy/out/policy_demo.mp4');

function tourFiles(): Plugin {
  return {
    name: 'geppetto-tour-files',
    apply: 'build',
    writeBundle() {
      for (const dir of [...APP_ASSETS, ...EXPLORE_ASSETS]) if (existsSync(resolve(here, 'public', dir))) cpSync(resolve(here, 'public', dir), resolve(OUT, dir), { recursive: true });
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

/**
 * Preloads for the first stop, written into the page head: its chunks (the 3D stage included) as modulepreload, and the
 * hand mesh as a fetch preload, so they download while the shell starts instead of one after another.
 */
function firstStopPreloads(): Plugin {
  return {
    name: 'geppetto-tour-preloads',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.filename.endsWith('tour.html')) return [];
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const wanted = ['src/tour/stops/ExpertStop.tsx', 'src/tour/stops/ExpertStage3D.tsx', 'tour/data/expert.json'];
        const files = new Set<string>();
        const add = (name: string) => {
          const c = bundle[name];
          if (!c || c.type !== 'chunk' || files.has(name)) return;
          files.add(name);
          c.imports.forEach(add);
        };
        for (const [name, c] of Object.entries(bundle)) {
          if (c.type === 'chunk' && c.facadeModuleId && wanted.some((w) => c.facadeModuleId!.replace(/\\/g, '/').endsWith(w))) add(name);
        }
        const tags = [...files].map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `./${f}` }, injectTo: 'head' as const }));
        tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'fetch', crossorigin: true, href: './models/hands/right.glb' } as never, injectTo: 'head' });
        tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'image', href: './posters/expert.jpg' } as never, injectTo: 'head' });
        return tags;
      },
    },
  };
}

/**
 * Explore mode honesty, for the public build only (the app's own build is untouched):
 * - the mock backend's canned AI Assistant text is labelled as a template ("fake ..."), so every screen says the AI
 *   Assistant was not used (score card, plan card, lesson generator, text-to-motion, model label);
 * - the developer-only model names (shown with ?dev=1) become neutral words, so no model or host name ships.
 * Each replacement must match, or the build fails: a silent miss would ship the old text.
 */
function exploreHonesty(): Plugin {
  const edits: { file: string; from: string; to: string }[] = [
    { file: 'src/mock/llm.ts', from: "export const MOCK_PROVIDER = 'mock';", to: "export const MOCK_PROVIDER = 'fake (example text)';" },
    { file: 'src/features/shared/providerLabel.ts', from: "gemini: 'Gemini',", to: "gemini: 'a hosted model'," },
    { file: 'src/features/shared/providerLabel.ts', from: "openai: 'Gemma on Verda',", to: "openai: 'a self-hosted model'," },
    // The glove engine's port: explore mode has no engine (the mock answers /ws/gloves and /ws/robot on the page's own
    // origin), so the port is removed from the public build; any engine socket would be refused by the network guard.
    { file: 'src/api/useRobotStream.ts', from: 'export const CORE_PORT = 8765;', to: 'export const CORE_PORT = 0;' },
    { file: 'src/features/typing/useTypingCore.ts', from: 'const CORE_PORT = 8765;', to: 'const CORE_PORT = 0;' },
  ];
  return {
    name: 'geppetto-explore-honesty',
    enforce: 'pre',
    transform(code, id) {
      const path = id.replace(/\\/g, '/').split('?')[0];
      let out = code;
      for (const e of edits) {
        if (!path.endsWith(e.file)) continue;
        if (!out.includes(e.from)) throw new Error(`explore honesty: "${e.from}" not found in ${e.file}`);
        out = out.replace(e.from, e.to);
      }
      return out === code ? null : out;
    },
  };
}

export default defineConfig({
  base: './',
  envPrefix: 'GEPPETTO_TOUR_NO_ENV_',
  publicDir: resolve(here, 'tour/public'),
  plugins: [exploreHonesty(), react(), tourFiles(), firstStopPreloads()],
  resolve: {
    preserveSymlinks: true,
    // The live hand's delay probe can call the core on :8765; the tour has no core, so it gets a stub that does nothing.
    alias: [{ find: /^(?:.*\/)?delayProbe$/, replacement: resolve(here, 'src/tour/stubs/delayProbe.ts') }],
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
    rollupOptions: { input: { tour: resolve(here, 'tour.html'), explore: resolve(here, 'explore.html') } },
  },
});
