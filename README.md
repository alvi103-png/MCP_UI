# Webs listas con la IA

Taller de la Upskilling Week Barcelona (Mobile World Capital): **MCP UI, WebMCP, Jev e IA local en el navegador**.

Web del taller: https://upskilling-mwc-taller.midudev.workers.dev

Este repositorio contiene:

| Carpeta | Qué es |
| --- | --- |
| `src/` | La web del taller (Astro): inicio, agenda, enunciados de los retos, documentación de las APIs y la presentación |
| `src/pages/api/` | Las APIs del taller: un proxy de **Jev** y otro de **OpenAI**, protegidos con un token compartido |
| `retos/` | Los cuatro retos, cada uno con `inicio/`, `solucion/` y su enunciado (`README.md`) |
| `directo/` | El código de las partes en directo. `directo/liga`: un MCP con los resultados de LaLiga y, después, con interfaz |

## Instalación

Es un monorepo: cada reto (`retos/*/inicio`, `retos/*/solucion`) y cada parte del directo (`directo/liga/*`) es un workspace. Un solo `install` en la raíz instala las dependencias de todo el proyecto, con el gestor que prefieras:

```bash
npm install    # o
pnpm install   # o
bun install
```

Hay un lockfile para cada uno (`package-lock.json`, `pnpm-lock.yaml` y `bun.lock`). Si cambias dependencias, actualiza los tres.

También puedes instalar desde la carpeta de un reto: `npm install` instala solo ese reto, y `pnpm install` o `bun install`, todo el monorepo.

## La web

```bash
pnpm install
cp .dev.vars.example .dev.vars   # y rellena las claves y el token del taller
pnpm dev
```

| Ruta | Contenido |
| --- | --- |
| `/` | Presentación del taller y requisitos |
| `/agenda` | Agenda con los tiempos de cada bloque (se edita en `src/data/agenda.ts`) |
| `/retos` | Enunciados. Se generan a partir de `retos/*/README.md` |
| `/apis` | Cómo usar las APIs de Jev y OpenAI |
| `/slides` | La presentación |

### Presentación

`→` `espacio` `Enter` siguiente · `←` anterior · `Inicio` / `Fin` · `F` pantalla completa. También con clic (mitad derecha o izquierda) y con mando de presentaciones. Cada slide tiene su URL: `/slides#12`.

Las slides están en `src/pages/slides.astro`; la primera y la última son las imágenes de `public/slides/`.

## Las APIs

Los asistentes usan un único token (`WORKSHOP_TOKEN`). Las claves reales se quedan en el servidor.

| Endpoint | Destino |
| --- | --- |
| `POST /api/jev` (o `/api/jev/v1/systemone`) | `api.typesafe.ai/v1/systemone` |
| `GET /api/jev/v1/models` | `api.typesafe.ai/v1/models` |
| `POST /api/openai/v1/chat/completions` | OpenAI |
| `POST /api/openai/v1/responses` | OpenAI |
| `GET /api/openai/v1/models` | Lista de modelos permitidos |

- CORS abierto, para llamarlas desde el navegador.
- Límite de 300 peticiones cada 10 s por IP, y 256 KB por petición (`wrangler.jsonc` y `src/lib/proxy.ts`). Como toda la sala comparte la Wi-Fi (y por tanto la IP), el límite está pensado para la sala entera. Las respuestas 429 llevan `Retry-After` (el SDK de OpenAI reintenta solo).
- Los modelos de OpenAI permitidos se configuran en `OPENAI_MODELS` (`wrangler.jsonc`).
- Son compatibles con los SDK oficiales cambiando la `baseURL` (ver `/apis`).

## Despliegue en Cloudflare

```bash
pnpm wrangler secret put WORKSHOP_TOKEN
pnpm wrangler secret put OPENAI_API_KEY
pnpm wrangler secret put TYPESAFE_API_KEY

pnpm build && pnpm wrangler deploy
```

El token no está en git. Se lee de `WORKSHOP_TOKEN` en `.dev.vars` al compilar y se muestra en `/apis` y en las slides; los asistentes lo pegan en `retos/*/src/config.js`. Tiene que coincidir con el secreto del Worker. Como `pnpm deploy` compila en local, la web desplegada sí lo muestra. Al terminar el taller, cambia el secreto para que deje de funcionar.

## Los retos

Una misma tienda online, cuatro piezas:

| Reto | Carpeta | Arrancar |
| --- | --- | --- |
| 1 · MCP UI | `retos/01-mcp-ui` | `npm install && npm run dev` → `http://localhost:3001/mcp` |
| 2 · WebMCP | `retos/02-webmcp` | `npm install && npm run dev` → `http://localhost:5173` |
| 3 · Jev | `retos/03-jev` | igual; pega el token en `src/config.js` |
| 4 · IA local | `retos/04-ia-local` | igual. `solucion/` es la aplicación completa |

Los retos 2, 3 y 4 comparten la misma tienda: el `inicio` de cada uno es la `solucion` del anterior. Solo cambian `src/webmcp.js`, `src/jev.js` y `src/ia-local.js`.
