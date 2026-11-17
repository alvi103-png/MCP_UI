---
title: MCP UI
bloque: 1
minutos: 18
resumen: Un servidor MCP para la tienda que, además de texto, devuelve una interfaz interactiva con el catálogo dentro del chat.
---

## Objetivo

El servidor MCP de la tienda ya tiene una herramienta `buscar_productos`, pero solo devuelve texto. Vas a convertirla en una **MCP App**: el asistente mostrará una cuadrícula de productos dentro del chat, con un botón para añadir al carrito que llama de vuelta al servidor.

<figure class="flujo">
<div class="flujo-scroll">
<div class="flujo-grid">
  <div class="flujo-panel flujo-panel--cliente" aria-hidden="true"></div>
  <div class="flujo-panel flujo-panel--servidor" aria-hidden="true"></div>
  <p class="flujo-titulo flujo-tc"><strong>Cliente MCP</strong> <span>el chat · VS Code, Claude…</span></p>
  <p class="flujo-titulo flujo-ts"><strong>Servidor MCP</strong> <span>la tienda · <code>server.js</code></span></p>
  <div class="flujo-c1">
    <p class="chat chat--usuario">busca algo de audio</p>
    <div class="chat chat--modelo">
      <p class="chat-quien">◆ modelo</p>
      <p>Busco en la tienda…</p>
      <p class="chat-tool"><code>buscar_productos({ categoria: 'audio' })</code></p>
    </div>
  </div>
  <div class="flujo-m flujo-m1">
    <span class="flujo-n">1</span>
    <p class="flecha flecha--ida"><code>tools/call</code></p>
    <p class="flecha flecha--vuelta"><code>texto + datos</code></p>
  </div>
  <div class="pieza flujo-s1">
    <p class="pieza-tipo">herramienta · <code>registerAppTool</code> <span class="todo">TODO 1</span></p>
    <p class="pieza-nombre"><code>buscar_productos</code></p>
    <p class="pieza-meta"><code>_meta.ui.resourceUri</code> <code class="uri">ui://tienda/catalogo.html</code></p>
    <dl>
      <dt><code>content</code></dt>
      <dd>texto para el modelo</dd>
      <dt><code>structuredContent</code></dt>
      <dd>datos para la vista</dd>
    </dl>
  </div>
  <div class="iframe flujo-cv">
    <p class="iframe-barra"><span class="iframe-puntos" aria-hidden="true"></span> <code class="uri">ui://tienda/catalogo.html</code> <span class="iframe-tag">iframe aislado</span></p>
    <p class="flujo-nota"><span class="flujo-n">3</span> <span>El cliente pinta el HTML y le pasa los datos con <code>toolresult</code> <span class="todo">TODO 4</span></span></p>
    <ul class="iframe-productos">
      <li><span class="emoji">🎧</span> Auriculares <b>149 €</b> <span class="boton boton--activo">Añadir</span></li>
      <li><span class="emoji">🎙️</span> Micrófono <b>79 €</b> <span class="boton">Añadir</span></li>
      <li><span class="emoji">🔊</span> Altavoz <b>59 €</b> <span class="boton">Añadir</span></li>
    </ul>
    <p class="flujo-nota"><span class="flujo-n">4</span> <span>El botón llama al servidor con <code>app.callServerTool()</code> <span class="todo">TODO 5</span></span></p>
    <p class="iframe-carrito">Carrito · 1 · 149 €</p>
  </div>
  <div class="flujo-m flujo-m2">
    <span class="flujo-n">2</span>
    <p class="flecha flecha--ida"><code>resources/read</code></p>
    <p class="flecha flecha--vuelta"><code>HTML</code></p>
  </div>
  <div class="pieza flujo-s2">
    <p class="pieza-tipo">recurso · <code>registerAppResource</code> <span class="todo">TODO 2</span></p>
    <p class="pieza-nombre uri"><code>ui://tienda/catalogo.html</code></p>
    <p class="pieza-desc">La carpeta <code>vista/</code> empaquetada en un único HTML</p>
  </div>
  <div class="flujo-m flujo-m3">
    <span class="flujo-n">4</span>
    <p class="flecha flecha--ida"><code>callServerTool</code></p>
    <p class="flecha flecha--vuelta"><code>carrito</code></p>
  </div>
  <div class="pieza flujo-s3">
    <p class="pieza-tipo">herramienta · <code>registerTool</code> <span class="todo">TODO 3</span></p>
    <p class="pieza-nombre"><code>anadir_al_carrito</code></p>
    <p class="pieza-desc"><code>{ id, cantidad }</code> → carrito. La puede usar el modelo… y también la vista</p>
  </div>
  <p class="flujo-nota flujo-c5"><span class="flujo-n flujo-n--extra">5</span> <span><code>app.updateModelContext()</code> avisa al modelo de lo que ha hecho el usuario <span class="todo">TODO 6 · extra</span></span></p>
</div>
</div>
<figcaption><span class="leyenda leyenda--ida">petición</span> <span class="leyenda leyenda--vuelta">respuesta</span> <span><span class="todo">TODO n</span> dónde lo programas: 1–3 en <code>server.js</code>, 4–6 en <code>vista/app.js</code></span></figcaption>
</figure>

## Arranca

```bash
cd retos/01-mcp-ui/inicio
npm install
npm run dev        # servidor en http://localhost:3001/mcp (se reinicia al guardar)
```

En otra terminal comprueba que responde:

```bash
npm run probar
```

Verás las herramientas y un aviso: todavía ninguna tiene interfaz.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `server.js` | El servidor MCP. **Aquí están los TODO 1, 2 y 3.** |
| `vista/app.js` | El JavaScript de la interfaz. **Aquí están los TODO 4, 5 y 6.** |
| `vista/index.html`, `vista/estilos.css` | HTML y estilos de la interfaz (ya hechos) |
| `lib/vista.js` | Empaqueta la vista en un único HTML (ya hecho) |
| `tienda.js`, `productos.js` | Catálogo y carrito: JavaScript normal, sin MCP |

## Pasos

### 1. Una herramienta con interfaz

En `server.js`, cambia `server.registerTool` por `registerAppTool` y enlaza la vista con `_meta.ui.resourceUri`. Devuelve los datos para la vista en `structuredContent`:

```js
registerAppTool(
  server,
  'buscar_productos',
  {
    title: 'Buscar productos',
    description: '…',
    inputSchema: z.object({ /* igual que antes */ }),
    _meta: { ui: { resourceUri: VISTA_CATALOGO } },
  },
  async (filtros) => {
    const productos = buscarProductos(filtros);
    return {
      content: [{ type: 'text', text: '…' }],                  // para el modelo
      structuredContent: { productos, carrito: verCarrito() },  // para la vista
    };
  },
);
```

> El `content` de texto sigue siendo importante: es lo que lee el modelo, y lo que ven los clientes que no muestran interfaces.

### 2. El recurso con el HTML

La herramienta apunta a `ui://tienda/catalogo.html`. Registra ese recurso:

```js
registerAppResource(
  server,
  'Catálogo de la tienda',
  VISTA_CATALOGO,
  { description: 'Cuadrícula de productos con botón para añadir al carrito' },
  async () => ({
    contents: [{ uri: VISTA_CATALOGO, mimeType: RESOURCE_MIME_TYPE, text: await crearVista() }],
  }),
);
```

Ejecuta `npm run probar`: ahora `buscar_productos` tiene interfaz.

### 3. La herramienta `anadir_al_carrito`

Una herramienta normal (`server.registerTool`) con `id` y `cantidad`. La usará el modelo… y también la vista. Devuelve el carrito en `structuredContent`, y `{ isError: true, … }` si el producto no existe.

### 4. La vista recibe el resultado

En `vista/app.js`, escucha el resultado de la herramienta y pinta los productos:

```js
app.addEventListener('toolresult', (resultado) => {
  const { productos, carrito } = resultado.structuredContent ?? {};
  if (productos) pintarProductos(productos);
  if (carrito) pintarCarrito(carrito);
});
```

### 5. La vista llama al servidor

Completa la función `añadir` con `app.callServerTool()` para que el botón funcione.

### 6. Extra: avisa al modelo

Si el usuario añade algo desde la interfaz, el modelo no se entera. Cuéntaselo con `app.updateModelContext()`.

## Pruébalo en un cliente

Necesitas un cliente compatible con MCP Apps. Tres opciones:

**MCPJam Inspector** (lo más rápido, sin cuenta):

```bash
npm run inspector
```

Añade un servidor HTTP con la URL `http://localhost:3001/mcp`, abre la herramienta `buscar_productos` y ejecútala.

**VS Code**: crea `.vscode/mcp.json` y pregunta en el chat «busca auriculares en la tienda»:

```json
{
  "servers": {
    "tienda": { "type": "http", "url": "http://localhost:3001/mcp" }
  }
}
```

**Claude Desktop** (arranca el servidor como proceso, con `--stdio`): añade a su configuración de servidores MCP:

```json
{
  "mcpServers": {
    "tienda": {
      "command": "node",
      "args": ["/RUTA/ABSOLUTA/retos/01-mcp-ui/inicio/server.js", "--stdio"]
    }
  }
}
```

## Qué te llevas

- Una herramienta MCP puede devolver **texto para el modelo** y **datos para una interfaz** a la vez.
- La interfaz es un recurso `ui://` con HTML que el cliente muestra en un **iframe aislado**.
- La comunicación es en los dos sentidos: `toolresult` (cliente → vista) y `callServerTool` (vista → servidor).

¿Te has perdido? La solución completa está en `retos/01-mcp-ui/solucion`.
