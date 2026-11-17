# En directo: LaLiga por MCP

Código para la parte en directo del bloque 1, antes del reto. Primero un servidor MCP normal, que solo devuelve texto, y después el mismo servidor con interfaz (MCP Apps).

Los datos salen de la API pública de ESPN (no necesita clave): clasificación, resultados de la última jornada y calendario de cada equipo.

| Carpeta | Qué es |
| --- | --- |
| `1-mcp` | Servidor MCP con tres herramientas que devuelven texto |
| `2-mcp-ui` | El mismo servidor con una vista: tabla, resultados y ficha de equipo |

En las dos, `liga.js` es JavaScript normal sin nada de MCP (como `tienda.js` en el reto 1). Todo lo de MCP está en `server.js` (y, en `2-mcp-ui`, también en `vista/app.js`).

**En directo no se escribe código: se descomenta.** Cada paso es un bloque marcado con `PASO N`. Selecciona sus líneas de código (no la cabecera) y pulsa `Cmd + /`. El servidor se reinicia solo al guardar y funciona después de cada paso. Para volver a empezar: `git checkout -- .` dentro de la carpeta.

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

Arranca `npm run dev` y deja otra terminal para `npm run probar`: después de cada paso enseña qué ha cambiado.

### Parte 1 · Un MCP normal (`1-mcp/server.js`)

Antes de descomentar nada, enseña `liga.js`: tres funciones que llaman a ESPN. Nada de MCP. `npm run probar` dice que el servidor aún no tiene herramientas.

| Paso | Qué descomentas | Qué explicas |
| --- | --- | --- |
| 1 | `server.registerTool('ver_clasificacion', …)` | Nombre, descripción (el modelo decide solo con eso) y una función que devuelve `content` de texto |
| 2 | `ver_resultados` | Otra herramienta igual. Un servidor puede ofrecer varias |
| 3 | `ver_equipo` | `inputSchema` con zod: el modelo sabe qué argumentos pasar. Si falla, `isError: true` |

Conéctalo a un cliente y pregunta en lenguaje natural:

- «¿Quién va líder de LaLiga?»
- «¿Cómo le fue al Barça el último partido y contra quién juega ahora?»
- «Resultados de la última jornada»

El problema: el modelo recibe veinte líneas de texto y responde con una tabla en markdown. Sin escudos, sin colores y sin poder tocar nada.

### Parte 2 · La misma herramienta, con interfaz (`2-mcp-ui`)

Parte del servidor de `1-mcp` terminado, con un único cambio ya hecho: `server.registerTool(…)` pasa a ser `registerAppTool(server, …)`, que es lo mismo pero entiende `_meta.ui`.

En `server.js`:

| Paso | Qué descomentas | Qué explicas |
| --- | --- | --- |
| 1 | `ui: { resourceUri: VISTA }` en las tres herramientas | La herramienta declara su vista, `ui://laliga/vista.html`. `probar` avisa de que el recurso aún no existe |
| 2 | `structuredContent` en las tres herramientas | El texto (`content`) es para el modelo; los datos (`structuredContent`), para la vista |
| 3 | `registerAppResource(…)` | El HTML de la vista, con `csp.resourceDomains` para que se vean los escudos de `a.espncdn.com` |

En `vista/app.js` (lo de arriba es pintar HTML; lo que importa está al final):

| Paso | Qué descomentas | Qué explicas |
| --- | --- | --- |
| 4 | `toolinput` y `toolresult` | El cliente le pasa a la vista los argumentos y el resultado. Ya se ve la tabla |
| 5 | `callServerTool()` | Las pestañas y los clics en un equipo llaman a las herramientas sin pasar por el modelo |
| 6 | `updateModelContext()` | Le cuenta al modelo qué equipo está mirando el usuario |
| 7 | `sendMessage()` | El botón «Pregúntale al asistente» escribe en el chat |
| 8 | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` | El tema, los colores y las fuentes se adaptan al cliente |

La vista se empaqueta cada vez que el cliente la pide, así que los cambios en `vista/app.js` no necesitan reiniciar nada: basta con volver a llamar a la herramienta.

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
