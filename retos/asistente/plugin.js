// El asistente de la tienda: un chat con gpt-6-luna que usa las herramientas WebMCP de la página
// (no hace falta tocar este archivo). Es un plugin de Vite: añade chat.js a las dos pestañas,
// «Tu código» y «Ver solución», sin tocar el index.html ni el main.js del reto.
import { fileURLToPath } from 'node:url';

const CHAT = fileURLToPath(new URL('./chat.js', import.meta.url));

export function asistente() {
  return {
    name: 'asistente',
    apply: 'serve',

    transformIndexHtml() {
      // Vite sirve cualquier archivo del proyecto con el prefijo /@fs/ + su ruta absoluta
      const src = `/@fs/${CHAT.replaceAll('\\', '/').replace(/^\//, '')}`;
      return [{ tag: 'script', attrs: { type: 'module', src }, injectTo: 'body' }];
    },
  };
}
