import { env as cfEnv } from 'cloudflare:workers';

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface WorkshopEnv {
  WORKSHOP_TOKEN?: string;
  OPENAI_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  OPENAI_MODELS?: string;
  JEV_DEFAULT_MODEL?: string;
  RATE_LIMITER?: RateLimiter;
}

export const env = cfEnv as unknown as WorkshopEnv;

/** Tamaño máximo del cuerpo de una petición a las APIs del taller. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Ventana del límite de peticiones en segundos (debe coincidir con `ratelimits` en wrangler.jsonc). */
const RATE_LIMIT_PERIOD = 10;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  // Para que el código del navegador (y los SDK) puedan leer cuánto esperar tras un 429
  'Access-Control-Expose-Headers': 'Retry-After',
};

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(data: unknown, status = 200): Response {
  return withCors(Response.json(data, { status }));
}

export function error(status: number, message: string, type = 'workshop_error'): Response {
  // Mismo formato que los errores de OpenAI, para que los SDK los muestren bien
  return json({ error: { message, type, code: status } }, status);
}

/**
 * Comprueba el token del taller y el límite de peticiones.
 * Devuelve una Response si hay que cortar la petición, o null si puede continuar.
 */
export async function guard(request: Request): Promise<Response | null> {
  if (!env.WORKSHOP_TOKEN) {
    return error(500, 'El servidor no tiene configurado WORKSHOP_TOKEN.');
  }

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== env.WORKSHOP_TOKEN) {
    return error(
      401,
      'Token del taller no válido. Envía la cabecera "Authorization: Bearer <TOKEN_DEL_TALLER>".',
      'invalid_token',
    );
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    return error(413, `La petición supera el máximo de ${MAX_BODY_BYTES / 1024} KB.`);
  }

  if (env.RATE_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      const response = error(
        429,
        'Demasiadas peticiones desde esta red (la Wi-Fi del taller se comparte). Espera unos segundos y vuelve a intentarlo.',
        'rate_limit',
      );
      // El SDK de OpenAI reintenta solo respetando Retry-After
      response.headers.set('retry-after', String(RATE_LIMIT_PERIOD));
      return response;
    }
  }

  return null;
}

/** Reenvía la respuesta del proveedor tal cual (incluido el streaming) añadiendo CORS. */
export function passthrough(upstream: Response): Response {
  const headers = new Headers();
  for (const name of ['content-type', 'cache-control', 'retry-after']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return withCors(new Response(upstream.body, { status: upstream.status, headers }));
}
