// El modelo vive en este Web Worker: descargar, compilar los shaders y generar no bloquea la página.
import {
  AutoProcessor,
  InterruptableStoppingCriteria,
  Qwen3_5ForConditionalGeneration,
  RawImage,
  TextStreamer,
  type PreTrainedModel,
  type Processor,
  type ProgressInfo,
} from '@huggingface/transformers';
import { DTYPE, MODELO, MUESTREO, NOMBRE, type Peticion, type Respuesta } from './modelo.ts';

let modelo: PreTrainedModel | null = null;
let procesador: Processor | null = null;
let cargando: Promise<void> | null = null;
let generando = false;
const parada = new InterruptableStoppingCriteria();

const enviar = (respuesta: Respuesta) => self.postMessage(respuesta);
const mensajeDe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const mb = (bytes: number) => Math.round(bytes / 1e6);

async function cargar() {
  if (modelo) return enviar({ estado: 'listo', dispositivo: 'webgpu' });

  const adaptador = await navigator.gpu?.requestAdapter();
  if (!adaptador) throw new Error('WebGPU no está disponible en este navegador');
  const dtype = adaptador.features.has('shader-f16') ? DTYPE.f16 : DTYPE.f32;

  // Cada archivo informa de sus bytes: se suman para tener una sola barra que nunca retrocede
  const archivos = new Map<string, { cargado: number; total: number }>();
  let mostrado = 0;
  const progress_callback = (info: ProgressInfo) => {
    if (info.status !== 'progress') return;
    archivos.set(info.file, { cargado: info.loaded, total: info.total });
    let cargado = 0;
    let total = 0;
    for (const archivo of archivos.values()) {
      cargado += archivo.cargado;
      total += archivo.total;
    }
    mostrado = Math.max(mostrado, total ? (cargado / total) * 100 : 0);
    enviar({ estado: 'cargando', texto: `Descargando ${NOMBRE} · ${mb(cargado)} / ${mb(total)} MB`, progreso: mostrado });
  };

  enviar({ estado: 'cargando', texto: 'Preparando…', progreso: 0 });

  const [p, m] = await Promise.all([
    AutoProcessor.from_pretrained(MODELO, { progress_callback }),
    Qwen3_5ForConditionalGeneration.from_pretrained(MODELO, { dtype, device: 'webgpu', progress_callback }),
  ]);

  // La primera generación compila los shaders de WebGPU: mejor ahora que en el primer mensaje
  enviar({ estado: 'cargando', texto: 'Compilando shaders y calentando el modelo…', progreso: 100 });
  await m.generate({ ...(await p('Hola')), max_new_tokens: 1 });

  procesador = p;
  modelo = m;
  enviar({ estado: 'listo', dispositivo: 'webgpu' });
}

async function generar({ id, mensajes, imagenes, razonar }: Extract<Peticion, { tipo: 'generar' }>) {
  if (!modelo || !procesador) return enviar({ estado: 'error', id, error: 'El modelo todavía no está cargado' });
  if (generando) return enviar({ estado: 'error', id, error: 'Ya hay una respuesta en curso' });
  generando = true;
  parada.reset();

  try {
    // enable_thinking lo lee la plantilla del chat: abre el bloque <think> o lo deja vacío
    const prompt = procesador.apply_chat_template(mensajes, { add_generation_prompt: true, enable_thinking: razonar } as never);
    const fotos = await Promise.all(imagenes.map((url) => RawImage.read(url)));
    const entradas = await procesador(prompt, fotos.length ? fotos : null);

    const inicio = performance.now();
    let primerToken = 0;
    let tokens = 0;

    const streamer = new TextStreamer(procesador.tokenizer!, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (texto: string) => enviar({ estado: 'trozo', id, texto }),
      token_callback_function: () => {
        if (tokens++ === 0) primerToken = performance.now();
      },
    });

    await modelo.generate({
      ...entradas,
      ...(razonar ? MUESTREO.razonando : MUESTREO.directo),
      do_sample: true,
      repetition_penalty: 1.05,
      max_new_tokens: razonar ? 4096 : 1024,
      streamer,
      stopping_criteria: parada,
    });

    const fin = performance.now();
    // Velocidad de decodificación: el primer token también paga el prefill, así que no cuenta
    const segundos = (fin - primerToken) / 1000;
    const tokensPorSegundo = tokens > 1 && segundos > 0 ? (tokens - 1) / segundos : 0;
    enviar({ estado: 'fin', id, tokens, tokensPorSegundo: Math.round(tokensPorSegundo * 10) / 10, milisegundos: Math.round(fin - inicio) });
  } catch (error) {
    enviar({ estado: 'error', id, error: mensajeDe(error) });
  } finally {
    generando = false;
  }
}

self.addEventListener('message', (evento: MessageEvent<Peticion>) => {
  const peticion = evento.data;
  switch (peticion.tipo) {
    case 'cargar':
      cargando ??= cargar().catch((error) => {
        cargando = null; // así el siguiente «cargar» lo vuelve a intentar
        enviar({ estado: 'error-carga', error: mensajeDe(error) });
      });
      break;
    case 'generar':
      generar(peticion);
      break;
    case 'parar':
      parada.interrupt();
      break;
  }
});
