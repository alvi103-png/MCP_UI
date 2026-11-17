import { defineConfig } from 'vite';
import { asistente } from '../../asistente/plugin.js'; // retos/asistente
import { verSolucion } from '../../ver-solucion.js'; // retos/ver-solucion.js

// La pestaña «Ver solución»: en /solucion/ se ejecuta la carpeta ../solucion con este mismo servidor.
// El asistente: un chat con gpt-6-luna que usa las herramientas WebMCP de la página.
export default defineConfig({
  plugins: [verSolucion(), asistente()],
});
