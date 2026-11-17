// Bloque 4 · IA en local: el modelo se ejecuta en el navegador.
// Las reseñas no salen del dispositivo, no hay coste por petición y funciona sin conexión.

// Modelo pequeño (unos 320 MB) para los navegadores sin IA integrada
const MODELO_WEBGPU = 'onnx-community/gemma-3-270m-it-ONNX';
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

// ── Plan B, ya implementado: un modelo pequeño con Transformers.js ─────────
// Sirve para los navegadores sin IA integrada. Léelo: es el mismo patrón
// (cargar modelo → generar en streaming) con una librería en vez de una API nativa.

/** El modelo se carga una sola vez y se reutiliza */
let generador;

async function resumirConTransformers(producto, { alProgresar, alEscribir }) {
  const { pipeline, TextStreamer } = await import(/* @vite-ignore */ TRANSFORMERS_JS);

  // WebGPU si hay GPU disponible; si no, WebAssembly (más lento)
  let device = 'wasm';
  try {
    if (await navigator.gpu?.requestAdapter()) device = 'webgpu';
  } catch {}

  generador ??= await pipeline('text-generation', MODELO_WEBGPU, {
    device,
    dtype: 'q4',
    progress_callback(progreso) {
      if (progreso.status === 'progress_total') alProgresar?.(Math.round(progreso.progress));
    },
  });

  let texto = '';
  const streamer = new TextStreamer(generador.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function(trozo) {
      texto += trozo;
      alEscribir?.(texto);
    },
  });

  const salida = await generador(
    [
      {
        role: 'system',
        content:
          'Resumes reseñas de clientes en español. Responde solo con dos frases cortas: lo mejor y lo peor del producto. Sin listas ni introducciones.',
      },
      { role: 'user', content: `Producto: ${producto.nombre}\n\nReseñas:\n${textoDeReseñas(producto)}` },
    ],
    { max_new_tokens: 120, do_sample: false, streamer },
  );

  return {
    texto: salida[0].generated_text.at(-1).content.trim(),
    motor: `Gemma 3 270M · Transformers.js (${device})`,
  };
}

/**
 * TODO 4 (extra): saca los puntos fuertes y débiles como JSON con la Prompt API.
 *   - LanguageModel.availability(opciones) y LanguageModel.create(opciones)
 *   - sesion.prompt(texto, { responseConstraint: <JSON Schema> }) obliga al modelo
 *     a responder con la forma { pros: string[], contras: string[] }
 *   - La respuesta llega como texto: JSON.parse(respuesta)
 */
export async function prosYContras(producto) {
  throw new Error('Pendiente: extra del bloque 4.');
}
