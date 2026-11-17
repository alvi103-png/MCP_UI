// Chat en local (/directo/chat): el modelo y los mensajes entre la página y el worker.

/** Qwen 3.5 0.8B: texto e imágenes, 201 idiomas y modo razonamiento. La versión OPT es la recomendada para Transformers.js */
export const MODELO = 'onnx-community/Qwen3.5-0.8B-ONNX-OPT';
export const NOMBRE = 'Qwen 3.5 · 0.8B';

/**
 * Cuantización. q4f16 necesita la extensión `shader-f16` de WebGPU (~790 MB en total);
 * sin ella, q4 (~710 MB). El codificador de imágenes va en fp16: en 4 bits se equivoca mucho más.
 */
export const DTYPE = {
  f16: { embed_tokens: 'q4f16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' },
  f32: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' },
} as const;

/** Muestreo recomendado por Qwen para cada modo (sin razonar / razonando) */
export const MUESTREO = {
  directo: { temperature: 0.7, top_p: 0.8, top_k: 20 },
  razonando: { temperature: 0.6, top_p: 0.95, top_k: 20 },
};

export type Contenido = string | Array<{ type: 'image' } | { type: 'text'; text: string }>;

export interface MensajeChat {
  role: 'system' | 'user' | 'assistant';
  content: Contenido;
}

export type Peticion =
  | { tipo: 'cargar' }
  /** `imagenes`: data URLs, en el mismo orden que las partes `{ type: 'image' }` de `mensajes` */
  | { tipo: 'generar'; id: string; mensajes: MensajeChat[]; imagenes: string[]; razonar: boolean }
  | { tipo: 'parar' };

export type Respuesta =
  | { estado: 'cargando'; texto: string; progreso: number }
  | { estado: 'listo'; dispositivo: string }
  | { estado: 'error-carga'; error: string }
  | { estado: 'trozo'; id: string; texto: string }
  | { estado: 'fin'; id: string; tokens: number; tokensPorSegundo: number; milisegundos: number }
  | { estado: 'error'; id: string; error: string };
