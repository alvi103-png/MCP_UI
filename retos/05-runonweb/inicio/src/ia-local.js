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
  if (!('Summarizer' in self)) return 'unavailable';

  // Si el navegador no contesta en 3 segundos, usamos el plan B
  const espera = new Promise((resolve) => setTimeout(resolve, 3000, 'unavailable'));
  return Promise.race([Summarizer.availability({ outputLanguage: 'es' }), espera]).catch(() => 'unavailable');
}

async function resumirConChrome(producto, { alProgresar, alEscribir }) {
  const summarizer = await Summarizer.create({
    type: 'tldr',
    format: 'plain-text',
    length: 'short',
    expectedInputLanguages: ['es'],
    outputLanguage: 'es',
    sharedContext: 'Reseñas de clientes de una tienda online.',
    monitor(monitor) {
      // La primera vez hay que descargar el modelo (solo una vez por navegador)
      monitor.addEventListener('downloadprogress', (evento) => alProgresar?.(Math.round(evento.loaded * 100)));
    },
  });

  let texto = '';
  const stream = summarizer.summarizeStreaming(textoDeReseñas(producto), {
    context: `Opiniones sobre el producto "${producto.nombre}".`,
  });
  for await (const trozo of stream) {
    texto += trozo;
    alEscribir?.(texto);
  }

  summarizer.destroy();
  return { texto, motor: 'Gemini Nano · API Summarizer de Chrome' };
}

/** El modelo se carga una sola vez y se reutiliza */
let generador;

async function resumirConTransformers(producto, { alProgresar, alEscribir }) {
  const { pipeline, TextStreamer } = await import(/* @vite-ignore */ TRANSFORMERS_JS);

  // WebGPU si hay GPU disponible; si no, WebAssembly (más lento).
  // Si la GPU calcula en media precisión (shader-f16), el modelo pesa menos: 470 MB en vez de 550 MB
  const gpu = await navigator.gpu?.requestAdapter().catch(() => null);
  const device = gpu ? 'webgpu' : 'wasm';
  const dtype = gpu?.features.has('shader-f16') ? 'q4f16' : 'q4';

  generador ??= await pipeline('text-generation', MODELO_WEBGPU, {
    device,
    dtype,
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
          'Resumes reseñas de clientes de una tienda online. Responde en español con una sola frase con esta forma: «Los clientes valoran …, aunque …». Primero lo que más gusta y, tras «aunque», la queja principal. Usa solo lo que dicen las reseñas.',
      },
      { role: 'user', content: `Producto: ${producto.nombre}\n\nReseñas:\n${textoDeReseñas(producto)}` },
    ],
    { max_new_tokens: 120, do_sample: false, repetition_penalty: 1.05, streamer },
  );

  return {
    texto: salida[0].generated_text.at(-1).content.trim(),
    motor: `Qwen3.5 0.8B · Transformers.js (${device})`,
  };
}

/**
 * Extra: saca los puntos fuertes y débiles como JSON con la Prompt API.
 * `responseConstraint` obliga al modelo a responder con un esquema concreto.
 */
export async function prosYContras(producto) {
  const opciones = {
    expectedInputs: [{ type: 'text', languages: ['es'] }],
    expectedOutputs: [{ type: 'text', languages: ['es'] }],
  };

  if (!('LanguageModel' in self) || (await LanguageModel.availability(opciones)) === 'unavailable') {
    throw new Error('La Prompt API no está disponible en este navegador.');
  }

  const sesion = await LanguageModel.create({
    ...opciones,
    initialPrompts: [{ role: 'system', content: 'Analizas reseñas de clientes de una tienda online.' }],
  });

  const respuesta = await sesion.prompt(`Extrae los puntos fuertes y débiles:\n${textoDeReseñas(producto)}`, {
    responseConstraint: {
      type: 'object',
      properties: {
        pros: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        contras: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      },
      required: ['pros', 'contras'],
    },
  });

  sesion.destroy();
  return JSON.parse(respuesta);
}
