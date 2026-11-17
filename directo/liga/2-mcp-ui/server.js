import { createServer } from 'node:http';
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import {
  NodeStreamableHTTPServerTransport,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { crearVista } from './lib/vista.js';
import { verClasificacion, verEquipo, verResultados } from './liga.js';

// Nuevo: la dirección de la vista. El esquema ui:// indica que es una interfaz de MCP Apps
const VISTA = 'ui://laliga/vista.html';

// Fechas en hora de Madrid: "sáb, 22 nov, 14:00"
const fecha = (iso) =>
  new Date(iso).toLocaleString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });

const marcador = ({ local, visitante }) => `${local.nombre} ${local.goles}-${visitante.goles} ${visitante.nombre}`;

function crearServidor() {
  const server = new McpServer({ name: 'laliga', version: '1.0.0' });

  // Antes: server.registerTool(…). Ahora: registerAppTool(server, …) con _meta.ui.resourceUri
  registerAppTool(
    server,
    'ver_clasificacion',
    {
      title: 'Clasificación de LaLiga',
      description: 'Devuelve la clasificación actual de LaLiga: posición, puntos, partidos y goles de cada equipo.',
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: VISTA } },
    },
    async () => {
      const clasificacion = await verClasificacion();
      const filas = clasificacion.equipos.map(
        (e) =>
          `${e.posicion}. ${e.nombre}: ${e.puntos} pts · ${e.jugados} PJ · ${e.ganados}G ${e.empatados}E ${e.perdidos}P · ` +
          `${e.golesAFavor} GF, ${e.golesEnContra} GC${e.zona ? ` · ${e.zona}` : ''}`,
      );

      return {
        // Texto para el modelo (y para los clientes que no muestran interfaces)
        content: [{ type: 'text', text: `Clasificación de LaLiga ${clasificacion.temporada}\n${filas.join('\n')}` }],
        // Nuevo: datos para la vista
        structuredContent: { clasificacion },
      };
    },
  );

  registerAppTool(
    server,
    'ver_resultados',
    {
      title: 'Resultados de la jornada',
      description: 'Devuelve los resultados de los partidos de la última jornada de LaLiga.',
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: VISTA } },
    },
    async () => {
      const resultados = await verResultados();
      const filas = resultados.partidos.map((p) => `- ${fecha(p.fecha)}: ${marcador(p)}${p.estado === 'in' ? ' (en juego)' : ''}`);

      return {
        content: [{ type: 'text', text: `Últimos resultados de LaLiga\n${filas.join('\n')}` }],
        structuredContent: { resultados },
      };
    },
  );

  registerAppTool(
    server,
    'ver_equipo',
    {
      title: 'Ficha de un equipo',
      description: 'Posición en la tabla, últimos cinco resultados y próximo partido de un equipo de LaLiga.',
      inputSchema: z.object({
        equipo: z.string().describe('Nombre o apodo del equipo, por ejemplo "Barça", "Atleti" o "Real Sociedad"'),
      }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: VISTA } },
    },
    async ({ equipo: texto }) => {
      try {
        const equipo = await verEquipo(texto);
        const { proximo } = equipo;

        const lineas = [
          `${equipo.nombre}: ${equipo.posicion}º en LaLiga ${equipo.temporada} con ${equipo.puntos} pts ` +
            `(${equipo.ganados}G ${equipo.empatados}E ${equipo.perdidos}P).`,
          'Últimos partidos (del más reciente al más antiguo):',
          ...equipo.ultimos.map((p) => `- ${p.resultado} · ${fecha(p.fecha)}: ${marcador(p)}`),
          proximo
            ? `Próximo partido: ${proximo.local.nombre} - ${proximo.visitante.nombre}, ${fecha(proximo.fecha)} en ${proximo.estadio}.`
            : 'No tiene partidos programados.',
        ];

        return { content: [{ type: 'text', text: lineas.join('\n') }], structuredContent: { equipo } };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    },
  );

  // Nuevo: el recurso con el HTML de la interfaz (las tres herramientas comparten la misma vista)
  registerAppResource(
    server,
    'LaLiga',
    VISTA,
    { description: 'Clasificación, resultados y fichas de equipo de LaLiga' },
    async () => ({
      contents: [
        {
          uri: VISTA,
          mimeType: RESOURCE_MIME_TYPE,
          text: await crearVista(),
          // La vista vive en un iframe con una CSP estricta: hay que permitir el CDN de los escudos
          _meta: { ui: { csp: { resourceDomains: ['https://a.espncdn.com'] } } },
        },
      ],
    }),
  );

  return server;
}

if (process.argv.includes('--stdio')) {
  // Para clientes que arrancan el servidor como proceso (Claude Desktop, por ejemplo)
  await crearServidor().connect(new StdioServerTransport());
} else {
  // Servidor HTTP en http://localhost:3003/mcp
  const PUERTO = Number(process.env.PORT ?? 3003);
  const hostValido = localhostHostValidation();
  const origenValido = localhostOriginValidation();

  createServer(async (req, res) => {
    if (!hostValido(req, res) || !origenValido(req, res)) return;

    if (new URL(req.url, 'http://localhost').pathname !== '/mcp') {
      res.writeHead(404).end('El servidor MCP está en /mcp');
      return;
    }

    // Sin sesiones: un servidor y un transporte por petición
    const transporte = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await crearServidor().connect(transporte);
    await transporte.handleRequest(req, res);
  }).listen(PUERTO, '127.0.0.1', () => {
    console.log(`Servidor MCP de LaLiga en http://localhost:${PUERTO}/mcp`);
  });
}
