// Empaqueta la vista (HTML + CSS + JS) en un único documento HTML.
// Los clientes MCP muestran la vista en un iframe aislado, sin acceso a archivos
// externos, así que todo tiene que viajar dentro del propio HTML.
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const carpeta = new URL('../vista/', import.meta.url);

export async function crearVista() {
  const [html, css, resultado] = await Promise.all([
    readFile(new URL('index.html', carpeta), 'utf8'),
    readFile(new URL('estilos.css', carpeta), 'utf8'),
    build({
      entryPoints: [new URL('app.js', carpeta).pathname],
      bundle: true,
      format: 'esm',
      minify: true,
      write: false,
    }),
  ]);

  // Evita que un "</script>" dentro del código cierre la etiqueta antes de tiempo
  const js = resultado.outputFiles[0].text.replaceAll('</script', '<\\/script');

  return html
    .replace('<!-- ESTILOS -->', () => `<style>${css}</style>`)
    .replace('<!-- SCRIPT -->', () => `<script type="module">${js}</script>`);
}
