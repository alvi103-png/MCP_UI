---
title: IA en local en la web
bloque: 4
minutos: 17
resumen: Resumimos las reseñas de cada producto con un modelo que se ejecuta en el navegador, sin que los datos salgan del dispositivo.
---

## Objetivo

El botón **Resumir reseñas en local** de cada producto va a funcionar con un modelo que se ejecuta **en el navegador del usuario**:

- **Privado**: las reseñas no salen del dispositivo.
- **Sin coste por petición**: no hay servidor ni API key.
- **Sin conexión**: una vez descargado el modelo, funciona en un avión.

Dos caminos:

| Camino | Qué es | Pega |
| --- | --- | --- |
| **APIs integradas de Chrome** | Gemini Nano dentro del navegador: `Summarizer`, `LanguageModel`, `Translator`… | Solo Chrome de escritorio y con requisitos de hardware |
| **WebGPU + Transformers.js** | Tú eliges y descargas el modelo; se ejecuta en la GPU | El usuario descarga cientos de MB |

## Arranca

```bash
cd retos/04-ia-local/inicio
npm install
npm run dev        # http://localhost:5173
```

Comprueba qué tiene tu navegador. En la consola de DevTools:

```js
'Summarizer' in self && (await Summarizer.availability());
// 'available' | 'downloadable' | 'downloading' | 'unavailable'
```

> Requisitos de Gemini Nano: Chrome de escritorio, 22 GB libres en disco y GPU con más de 4 GB de VRAM (o 16 GB de RAM y 4 núcleos). Si te sale `unavailable`, no pasa nada: el plan B con Transformers.js ya está implementado y el botón funcionará igualmente.

## Pasos

Todo el trabajo está en `src/ia-local.js`.

### 1. ¿Está disponible?

Completa `disponibilidad()`:

```js
if (!('Summarizer' in self)) return 'unavailable';
return Summarizer.availability({ outputLanguage: 'es' });
```

### 2. Crea el resumidor

```js
const summarizer = await Summarizer.create({
  type: 'tldr',              // 'key-points' | 'tldr' | 'teaser' | 'headline'
  format: 'plain-text',      // 'markdown' | 'plain-text'
  length: 'short',           // 'short' | 'medium' | 'long'
  expectedInputLanguages: ['es'],
  outputLanguage: 'es',
  sharedContext: 'Reseñas de clientes de una tienda online.',
  monitor(monitor) {
    monitor.addEventListener('downloadprogress', (evento) => {
      alProgresar?.(Math.round(evento.loaded * 100));
    });
  },
});
```

La primera vez, Chrome descarga el modelo (una sola vez para todas las webs). Por eso `create()` necesita que el usuario haya hecho clic.

### 3. Resume en streaming

```js
let texto = '';
const stream = summarizer.summarizeStreaming(textoDeReseñas(producto), {
  context: `Opiniones sobre el producto "${producto.nombre}".`,
});

for await (const trozo of stream) {
  texto += trozo;
  alEscribir?.(texto);
}

return { texto, motor: 'Gemini Nano · API Summarizer de Chrome' };
```

Abre un producto y pulsa el botón. Luego desconecta el wifi y vuelve a probar.

### 4. Lee el plan B

`resumirConTransformers()` ya está hecho. Es el mismo patrón con una librería:

```js
const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2');

const generador = await pipeline('text-generation', 'onnx-community/gemma-3-270m-it-ONNX', {
  device: 'webgpu',   // o 'wasm' si no hay GPU
  dtype: 'q4',        // cuantización: menos peso, algo menos de calidad
});
```

Compara los dos resúmenes: un modelo de 270 millones de parámetros se queda corto donde Gemini Nano acierta. **Esa es la limitación**: en local, el tamaño del modelo lo paga el usuario.

### 5. Extra: JSON garantizado con la Prompt API

Implementa `prosYContras()` con `LanguageModel` y `responseConstraint`: le pasas un JSON Schema y el modelo solo puede responder con esa forma.

```js
const respuesta = await sesion.prompt('Extrae los puntos fuertes y débiles: …', {
  responseConstraint: {
    type: 'object',
    properties: {
      pros: { type: 'array', items: { type: 'string' } },
      contras: { type: 'array', items: { type: 'string' } },
    },
    required: ['pros', 'contras'],
  },
});

JSON.parse(respuesta);
```

### 6. Extra: el resumen como herramienta WebMCP

Registra `resumir_resenas` en `src/webmcp.js`. Un agente del navegador pedirá el resumen y lo generará **el navegador del usuario**, no la nube.

## ¿Local o nube?

| | Local | Nube |
| --- | --- | --- |
| Privacidad | Los datos no salen del dispositivo | Viajan a un tercero |
| Coste | Cero por petición | Por token |
| Sin conexión | Sí | No |
| Calidad | Modelos pequeños: tareas acotadas | Los mejores modelos |
| Primera vez | Descarga del modelo | Inmediato |
| Compatibilidad | Depende del navegador y del hardware | Cualquier dispositivo |

**Regla práctica**: local para tareas pequeñas y frecuentes sobre datos del usuario (resumir, traducir, corregir, clasificar). Nube cuando hace falta razonar, mucho contexto o que funcione igual en todos los dispositivos. Y siempre con plan B.

## La aplicación completa

`retos/04-ia-local/solucion` es la tienda con las cuatro piezas:

- **MCP UI**: el catálogo dentro del chat (`retos/01-mcp-ui/solucion`).
- **WebMCP**: siete herramientas y un formulario para los agentes del navegador.
- **Jev**: búsqueda inteligente y moderación de reseñas.
- **IA local**: resumen de reseñas en el dispositivo.
