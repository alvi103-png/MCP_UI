# En directo: LaLiga por MCP

Código para la parte en directo del bloque 1, antes del reto. Primero un servidor MCP normal, que solo devuelve texto, y después el mismo servidor con interfaz (MCP Apps).

Los datos salen de la API pública de ESPN (no necesita clave): clasificación, resultados de la última jornada y calendario de cada equipo.

| Carpeta | Qué es |
| --- | --- |
| `1-mcp` | Servidor MCP con tres herramientas que devuelven texto |
| `2-mcp-ui` | El mismo servidor con una vista: tabla, resultados y ficha de equipo |

En las dos, `liga.js` es JavaScript normal sin nada de MCP (como `tienda.js` en el reto 1). Todo lo de MCP está en `server.js`.

## Herramientas

| Herramienta | Entrada | Devuelve |
| --- | --- | --- |
| `ver_clasificacion` | — | La tabla de LaLiga |
| `ver_resultados` | — | Los partidos de la última jornada |
| `ver_equipo` | `equipo`: nombre o apodo («Barça», «Atleti», «la Real») | Posición, últimos cinco resultados y próximo partido |

## Arrancar

```bash
cd directo/liga/1-mcp      # o 2-mcp-ui
npm install
npm run dev                # http://localhost:3003/mcp
npm run probar             # en otra terminal
```

## Guion

### Paso 1 · Un MCP normal (`1-mcp`)

1. Enseña `liga.js`: tres funciones que llaman a ESPN. Nada de MCP.
2. En `server.js`, `server.registerTool()` con nombre, descripción, `inputSchema` (zod) y la función que devuelve `content` de texto.
3. `npm run probar`: lista las herramientas y llama a dos.
4. Conéctalo a un cliente y pregunta en lenguaje natural:
   - «¿Quién va líder de LaLiga?»
   - «¿Cómo le fue al Barça el último partido y contra quién juega ahora?»
   - «Resultados de la última jornada»
5. El problema: el modelo recibe veinte líneas de texto y responde con una tabla en markdown. Sin escudos, sin colores y sin poder tocar nada.

### Paso 2 · La misma herramienta, con interfaz (`2-mcp-ui`)

Compara los dos `server.js` (`diff 1-mcp/server.js 2-mcp-ui/server.js`). Solo cambian cuatro cosas:

1. `server.registerTool(…)` pasa a ser `registerAppTool(server, …)` con `_meta: { ui: { resourceUri: 'ui://laliga/vista.html' } }`.
2. Cada herramienta devuelve además `structuredContent`, los datos para la vista. El `content` de texto se queda para el modelo.
3. `registerAppResource()` sirve el HTML de la vista, con `csp.resourceDomains` para que se vean los escudos de `a.espncdn.com`.
4. La vista (`vista/app.js`):
   - `toolinput` y `toolresult`: el cliente le pasa los argumentos y el resultado.
   - `callServerTool()`: las pestañas y los clics en un equipo llaman a las herramientas sin pasar por el modelo.
   - `updateModelContext()`: le cuenta al modelo qué equipo está mirando el usuario.
   - `sendMessage()`: el botón «Pregúntale al asistente» escribe en el chat.
   - El tema, los colores y las fuentes se adaptan al cliente (`applyDocumentTheme`, `applyHostStyleVariables`).

Vuelve a hacer las mismas preguntas: ahora la respuesta es una tabla con escudos y zonas, y se puede navegar por ella.

## Clientes

**MCPJam Inspector**: `npm run inspector`, añade un servidor HTTP con `http://localhost:3003/mcp` y ejecuta las herramientas.

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "laliga": { "type": "http", "url": "http://localhost:3003/mcp" }
  }
}
```

**Claude Desktop**:

```json
{
  "mcpServers": {
    "laliga": {
      "command": "node",
      "args": ["/RUTA/ABSOLUTA/directo/liga/2-mcp-ui/server.js", "--stdio"]
    }
  }
}
```
