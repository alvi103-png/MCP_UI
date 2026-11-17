// El probador: una web para comprobar un servidor MCP desde el navegador.
// Los servidores de directo/liga y de retos/01-mcp-ui la sirven en todo lo que no es /mcp.
import { readFile } from 'node:fs/promises';

const ARCHIVOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/probador.css': ['estilos.css', 'text/css; charset=utf-8'],
  '/probador.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['../public/favicon.svg', 'image/svg+xml'],
  '/fuentes/mono.woff2': ['../src/assets/fonts/GeistMono-Latin.woff2', 'font/woff2'],
  '/fuentes/pixel.woff2': ['../src/assets/fonts/GeistPixel-Square-Latin.woff2', 'font/woff2'],
};

export async function servirProbador(pathname, res) {
  const [ruta, tipo] = ARCHIVOS[pathname] ?? [];

  try {
    if (!ruta) throw new Error();
    const contenido = await readFile(new URL(ruta, import.meta.url));
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' }).end(contenido);
  } catch {
    res.writeHead(404).end('El servidor MCP está en /mcp');
  }
}
