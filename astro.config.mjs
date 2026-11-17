// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Fuentes subseteadas con `pnpm fonts` (scripts/subset-fonts.sh). Astro las sirve con hash en
// /_astro/fonts/ (caché inmutable), inyecta el @font-face en línea y genera fallbacks con métricas
// ajustadas para evitar saltos de layout mientras cargan.
const fallbacks = ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'];

// Las páginas se prerenderizan (estáticas). Solo /api/* se ejecuta en el Worker.
export default defineConfig({
  adapter: cloudflare(),
  // agenda.html en vez de agenda/index.html: Cloudflare sirve /agenda directamente (200) en lugar de
  // redirigir con un 307 a /agenda/, que añadía un round-trip antes del HTML (y de las fuentes)
  build: { format: 'file' },
  // Las APIs se llaman desde otros orígenes y se protegen con el token del taller
  security: { checkOrigin: false },
  markdown: {
    shikiConfig: { theme: 'css-variables' },
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Geist Pixel',
      cssVariable: '--font-pixel',
      fallbacks,
      options: {
        variants: [{ src: ['./src/assets/fonts/GeistPixel-Square-Latin.woff2'], weight: '400 500', style: 'normal' }],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Geist Mono',
      cssVariable: '--font-mono',
      fallbacks,
      options: {
        variants: [{ src: ['./src/assets/fonts/GeistMono-Latin.woff2'], weight: '400 700', style: 'normal' }],
      },
    },
  ],
});
