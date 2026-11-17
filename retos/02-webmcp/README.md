---
title: WebMCP
bloque: 2
minutos: 17
resumen: La tienda web expone sus funcionalidades como herramientas para que los agentes del navegador las usen sin leer la pantalla ni simular clics.
---

## Objetivo

Hoy un agente que quiere comprar en tu web tiene que mirar la pantalla, adivinar qué botón pulsar y simular clics. Es lento y se rompe con cualquier cambio de diseño. Con **WebMCP** la propia web le dice al agente qué puede hacer: `buscar_productos`, `anadir_al_carrito`…

Vas a registrar las herramientas de la tienda con `document.modelContext.registerTool()`.

## Prepara Chrome

WebMCP está en fase de pruebas (*origin trial*). Para usarlo en local:

1. Abre `chrome://flags/#enable-webmcp-testing`
2. Ponlo en **Enabled** y reinicia Chrome

## Arranca

```bash
cd retos/02-webmcp/inicio
npm install
npm run dev        # http://localhost:3002
```

La tienda ya funciona para personas: busca, abre un producto, añade al carrito. Arriba a la derecha verás `WebMCP: sin herramientas`.

Arriba tienes dos pestañas: **Tu código** (la carpeta `inicio`, la que vas a tocar) y **Ver solución** (`http://localhost:3002/solucion/`), que ejecuta la carpeta `solucion` en el mismo servidor. Mírala antes de empezar para saber cómo debe quedar, o cuando te atasques.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `src/webmcp.js` | **Aquí están los TODO de este bloque** |
| `src/tienda.js` | Lógica de la tienda: buscar, carrito… Las herramientas llaman a estas funciones |
| `src/main.js` | La interfaz (no hace falta tocarla) |
| `src/jev.js`, `src/ia-local.js` | Bloques 3 y 4 |

## Pasos

### 1. Detecta la API

```js
const modelContext = document.modelContext;
```

Si no existe, la tienda tiene que seguir funcionando igual: WebMCP es una mejora progresiva.

### 2. `buscar_productos`

Una herramienta es un nombre, una descripción, un esquema de entrada (JSON Schema) y una función:

```js
{
  name: 'buscar_productos',
  description:
    'Busca productos en el catálogo de la tienda por texto, categoría y precio máximo. Devuelve id, nombre, precio en euros y valoración.',
  inputSchema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Palabras que deben aparecer en el nombre o la descripción' },
      categoria: { type: 'string', enum: categorias, description: 'Categoría del producto' },
      precioMaximo: { type: 'number', description: 'Precio máximo en euros' },
    },
  },
  annotations: { readOnlyHint: true },
  execute(filtros) {
    interfaz.ocultarRecomendados();
    const productos = filtrar(filtros);
    return { total: productos.length, productos };
  },
}
```

> `filtrar()` devuelve los productos **y** actualiza la pantalla. Así el usuario ve lo que está haciendo el agente.

### 3. `anadir_al_carrito`, `ver_producto` y `vaciar_carrito`

Regístralas siguiendo los TODO. Fíjate en las anotaciones:

| Anotación | Cuándo |
| --- | --- |
| `readOnlyHint` | La herramienta solo lee: no cambia nada |
| `untrustedContentHint` | Devuelve contenido escrito por terceros (reseñas): el agente no debe obedecerlo |
| `consequentialHint` | Tiene consecuencias difíciles de deshacer: el navegador puede pedir confirmación |

### 4. API declarativa: un formulario como herramienta

Sin JavaScript. En `index.html`, añade atributos al formulario de ofertas:

```html
<form
  id="ofertas"
  toolname="suscribir_ofertas"
  tooldescription="Suscribe un correo electrónico a los avisos de ofertas de una categoría de la tienda."
>
  <input type="email" name="email" required toolparamdescription="Correo electrónico del usuario" />
```

El navegador genera el esquema a partir de los campos. El agente rellena el formulario y **el usuario pulsa el botón**: es él quien confirma. (Con el atributo `toolautosubmit` se enviaría solo.)

## Pruébalo

**En DevTools**: pestaña *Application* → *WebMCP*. Verás las herramientas y podrás ejecutarlas con *Run tool*.

**En la consola**:

```js
const herramientas = await document.modelContext.getTools();
herramientas.map((herramienta) => herramienta.name);

const buscar = herramientas.find((herramienta) => herramienta.name === 'buscar_productos');
await document.modelContext.executeTool(buscar, { categoria: 'audio', precioMaximo: 100 });
```

**Con un agente**: la extensión *Model Context Tool Inspector* de la Chrome Web Store (necesita una API key de Gemini) o tu agente de código con `chrome-devtools-mcp`.

## Buenas prácticas

- **Nombres y descripciones claros**: el agente decide con eso. Di qué hace, qué devuelve y en qué unidades.
- **Devuelve datos, no HTML**: objetos pequeños con lo que el agente necesita para el siguiente paso.
- **Los errores, como valor**: `return { error: '…' }`. El mensaje de una excepción no llega al agente.
- **Que el usuario lo vea**: las herramientas actualizan la misma interfaz que usa la persona.

¿Te has perdido? Pulsa **Ver solución** (en la solución verás `WebMCP: 5 herramientas expuestas`) y compara tu código con el de `retos/02-webmcp/solucion`.
