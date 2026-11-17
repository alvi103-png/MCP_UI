// Bloque 3 · Jev: decisiones rápidas y estructuradas.
// Jev no genera texto: responde preguntas sobre un contenido (state) con datos
// que el código usa directamente (una opción, una puntuación o una probabilidad).
import { API_URL, TOKEN } from './config.js';
import { todosLosProductos } from './tienda.js';

/** Envía un contenido y varias preguntas a Jev. Devuelve las respuestas por nombre. */
async function preguntarAJev(state, questions) {
  // TODO 1: haz la petición a la API del taller.
  //   POST `${API_URL}/api/jev`
  //   Cabeceras: Authorization: `Bearer ${TOKEN}` y Content-Type: application/json
  //   Cuerpo:    JSON.stringify({ state, questions })
  //   Devuelve `answers` de la respuesta. Si la respuesta no es ok, lanza un Error.
  throw new Error('Pendiente: la búsqueda inteligente se implementa en el bloque 3 (src/jev.js).');
}

/**
 * Ordena el catálogo según lo bien que encaja con lo que pide el cliente.
 * Devuelve [{ producto, encaje }] con encaje entre 0 y 1.
 */
export async function busquedaInteligente(peticion) {
  const productos = todosLosProductos();
  const NIVELES = ['No encaja con lo que pide', 'Encaja solo en parte', 'Encaja muy bien con lo que pide'];

  // TODO 2: una sola llamada a Jev con una pregunta `score` por producto.
  //   const questions = {}
  //   questions[producto.id] = {
  //     type: 'score',
  //     instructions: { tarea: '¿Cuánto encaja…?', producto: { nombre, descripcion, categoria, precio_en_euros } },
  //     criteria: NIVELES,
  //   }
  //   const answers = await preguntarAJev({ peticion_del_cliente: peticion }, questions)
  //
  //   answers[producto.id].score va de 0 a 2 (la posición en NIVELES).
  //   Pásalo a un valor entre 0 y 1, quédate con los que lleguen a 0.5
  //   y ordénalos de mayor a menor.
  await preguntarAJev({ peticion_del_cliente: peticion }, {});
  return [];
}

/**
 * Decide si una reseña se puede publicar y le pone nota.
 * Devuelve { publicar: true, nota } o { publicar: false, motivo }.
 */
export async function moderarReseña(texto, producto) {
  // TODO 3: tres preguntas en una sola llamada.
  //   inapropiada → type: 'noul'    ¿contiene insultos, spam, publicidad o datos personales?
  //   tema        → type: 'choice'  criteria: { producto: '…', envio: '…', otro: '…' }
  //   nota        → type: 'score'   criteria: ['Muy mala', 'Mala', 'Regular', 'Buena', 'Muy buena']
  //
  //   Decide con números, sin interpretar texto:
  //   - answers.inapropiada.noul > 0.5            → no se publica
  //   - answers.tema.choice === 'otro' (y con confidence alta) → no se publica
  //   - nota: Math.round(answers.nota.score) + 1  → estrellas de 1 a 5
  //
  // Mientras no esté implementado, las reseñas se publican sin revisar:
  return { publicar: true, nota: 3 };
}
