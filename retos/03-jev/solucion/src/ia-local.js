// Bloque 4 · IA en local: el modelo se ejecuta en el navegador.
// Las reseñas no salen del dispositivo, no hay coste por petición y funciona sin conexión.

// Modelo pequeño (unos 470 MB) para los navegadores sin IA integrada.
// Qwen3.5 0.8B: multilingüe y de 2026. Gemma 4 E2B escribe mejor, pero pesa unos 3 GB.
const MODELO_WEBGPU = 'onnx-community/Qwen3.5-0.8B-Text-ONNX';
const TRANSFORMERS_JS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

const textoDeReseñas = (producto) =>
  producto.reseñas.map((reseña) => `${reseña.autor} (${reseña.nota}/5): ${reseña.texto}`).join('\n');

/**
 * Resume las reseñas de un producto sin salir del navegador.
 * Devuelve { texto, motor }.
 *   alProgresar(porcentaje) → progreso de la descarga del modelo
 *   alEscribir(parcial)     → texto generado hasta el momento (streaming)
 */
export async function resumirReseñas(producto, { alProgresar, alEscribir } = {}) {
  // 1. API integrada en Chrome (Gemini Nano)
  if ((await disponibilidad()) !== 'unavailable') {
    return resumirConChrome(producto, { alProgresar, alEscribir });
  }

  // 2. Plan B: un modelo pequeño con Transformers.js (WebGPU, o WASM si no hay GPU)
  return resumirConTransformers(producto, { alProgresar, alEscribir });
}

/** Estado de la API Summarizer: 'unavailable', 'downloadable', 'downloading' o 'available' */
async function disponibilidad() {
  // TODO 1: comprueba si el navegador tiene la API Summarizer.
  //   - Si no existe ('Summarizer' in self), devuelve 'unavailable'
  //   - Si existe, devuelve await Summarizer.availability({ outputLanguage: 'es' })
  return 'unavailable';
}

async function resumirConChrome(producto, { alProgresar, alEscribir }) {
  // TODO 2: crea el resumidor.
  //   const summarizer = await Summarizer.create({
  //     type: 'tldr', format: 'plain-text', length: 'short',
  //     expectedInputLanguages: ['es'], outputLanguage: 'es',
  //     sharedContext: 'Reseñas de clientes de una tienda online.',
  //     monitor(monitor) {
  //       // evento.loaded va de 0 a 1 → alProgresar?.(porcentaje)
  //       monitor.addEventListener('downloadprogress', (evento) => { … })
  //     },
  //   })
  //
  // TODO 3: resume en streaming para que el texto aparezca según se genera.
  //   const stream = summarizer.summarizeStreaming(textoDeReseñas(producto), { context: '…' })
  //   for await (const trozo of stream) { texto += trozo; alEscribir?.(texto) }
  //
  // Devuelve { texto, motor: 'Gemini Nano · API Summarizer de Chrome' }
  throw new Error('Pendiente: el resumen con la API de Chrome se implementa en el bloque 4 (src/ia-local.js).');
}

// ── Plan B: un modelo pequeño con Transformers.js ─────────────────────────
// Para los navegadores sin IA integrada. Es el mismo patrón (cargar modelo →
// generar en streaming) con una librería en vez de una API nativa.

/** El modelo se carga una sola vez y se reutiliza */
let generador;

async function resumirConTransformers(producto, { alProgresar, alEscribir }) {
  // TODO 4: resume con Transformers.js.
  //   const { pipeline, TextStreamer } = await import(/* @vite-ignore */ TRANSFORMERS_JS)
  //
  //   WebGPU si hay GPU; si no, WebAssembly (más lento). Con shader-f16 el modelo pesa menos:
  //   const gpu = await navigator.gpu?.requestAdapter().catch(() => null)
  //   const device = gpu ? 'webgpu' : 'wasm'
  //   const dtype = gpu?.features.has('shader-f16') ? 'q4f16' : 'q4'
  //
  //   generador ??= await pipeline('text-generation', MODELO_WEBGPU, {
  //     device, dtype,
  //     // progreso.status === 'progress_total' → alProgresar?.(Math.round(progreso.progress))
  //     progress_callback(progreso) { … },
  //   })
  //
  //   El streamer recibe el texto según se genera:
  //   const streamer = new TextStreamer(generador.tokenizer, {
  //     skip_prompt: true, skip_special_tokens: true,
  //     callback_function(trozo) { texto += trozo; alEscribir?.(texto) },
  //   })
  //
  //   const salida = await generador([
  //     { role: 'system', content: 'Resumes reseñas … en una sola frase: «Los clientes valoran …, aunque …»' },
  //     { role: 'user', content: `Producto: ${producto.nombre}\n\nReseñas:\n${textoDeReseñas(producto)}` },
  //   ], { max_new_tokens: 120, do_sample: false, repetition_penalty: 1.05, streamer })
  //
  // Devuelve { texto: salida[0].generated_text.at(-1).content.trim(), motor: `Qwen3.5 0.8B · Transformers.js (${device})` }
  throw new Error('Pendiente: el resumen con Transformers.js se implementa en el bloque 4 (src/ia-local.js).');
}

/**
 * TODO 5 (extra): saca los puntos fuertes y débiles como JSON con la Prompt API.
 *   - LanguageModel.availability(opciones) y LanguageModel.create(opciones)
 *   - sesion.prompt(texto, { responseConstraint: <JSON Schema> }) obliga al modelo
 *     a responder con la forma { pros: string[], contras: string[] }
 *   - La respuesta llega como texto: JSON.parse(respuesta)
 */
export async function prosYContras(producto) {
  throw new Error('Pendiente: extra del bloque 4.');
}
