import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // The gateway is normally run via `npm run dev` (see start.bat), not a production
        // build - without this, the manifest/service worker are only injected on `vite
        // build`, so "Install app" would never actually show up in day-to-day use.
        devOptions: { enabled: true, type: 'module' },
        includeAssets: ['icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Local AI Media Gateway',
          short_name: 'AI Gateway',
          description: 'Local ComfyUI media generation gateway and control hub for the RTX 3060 Ti.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#020617',
          background_color: '#020617',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Real-time API routes (VRAM telemetry, generation status, SSE progress) must
          // never be intercepted or cached - only the app shell is precached.
          navigateFallbackDenylist: [/^\/api/],
          // Take over immediately on update instead of waiting for every open tab of the
          // old version to close - this app changes often and should never run stale code.
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Vite's dev server otherwise rejects any request whose Host header isn't
      // localhost-like (DNS-rebinding protection) - which blocks every request that
      // arrives through the Cloudflare tunnel, whether the ephemeral *.trycloudflare.com
      // quick-tunnel hostname or a configured stable CLOUDFLARE_TUNNEL_HOSTNAME, since
      // neither is predictable/listable in advance. The real security boundary here is the
      // gateway's own Bearer auth on /api (see server.ts) and this being a single-user,
      // single-GPU local tool, not a multi-tenant host - so allowing every Host is correct
      // for a tunnel-accessed dev server, not a gap.
      allowedHosts: true as const,
    },
  };
});
