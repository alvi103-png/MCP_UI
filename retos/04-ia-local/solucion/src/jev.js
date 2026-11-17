// Bloque 3 · Jev: decisiones rápidas y estructuradas.
// Jev no genera texto: responde preguntas sobre un contenido (state) con datos
// que el código usa directamente (una opción, una puntuación o una probabilidad).
import { API_URL, TOKEN } from './config.js';
import { todosLosProductos } from './tienda.js';

/** Envía un contenido y varias preguntas a Jev. Devuelve las respuestas por nombre. */
async function preguntarAJev(state, questions) {
  const respuesta = await fetch(`${API_URL}/api/jev`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, questions }),
  });

  const datos = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(`Jev ha respondido ${respuesta.status}: ${datos.error?.message ?? JSON.stringify(datos.detail)}`);
  }
  return datos.answers;
}

/**
 * Ordena el catálogo según lo bien que encaja con lo que pide el cliente.
 * Una sola llamada con una pregunta `score` por producto.
 * Devuelve [{ producto, encaje }] con encaje entre 0 y 1.
 */
export async function busquedaInteligente(peticion) {
  const productos = todosLosProductos();
  const NIVELES = ['No encaja con lo que pide', 'Encaja solo en parte', 'Encaja muy bien con lo que pide'];

  const questions = {};
  for (const producto of productos) {
    questions[producto.id] = {
      type: 'score',
      instructions: {
        tarea: '¿Cuánto encaja este producto con la petición del cliente? Ten en cuenta el uso y el presupuesto.',
        producto: {
          nombre: producto.nombre,
          descripcion: producto.descripcion,
          categoria: producto.categoria,
          precio_en_euros: producto.precio,
        },
      },
      criteria: NIVELES,
    };
  }

  const answers = await preguntarAJev({ peticion_del_cliente: peticion }, questions);

  return productos
    .map((producto) => ({
      producto,
      // score va de 0 al último nivel (2): lo pasamos a un valor entre 0 y 1
      encaje: answers[producto.id].score / (NIVELES.length - 1),
    }))
    .filter(({ encaje }) => encaje >= 0.5)
    .sort((a, b) => b.encaje - a.encaje);
}

/**
 * Decide si una reseña se puede publicar y le pone nota.
 * Tres preguntas en una sola llamada: noul (sí/no), choice (elegir) y score (puntuar).
 * Devuelve { publicar, motivo, nota }.
 */
export async function moderarReseña(texto, producto) {
  const answers = await preguntarAJev(
    { producto: producto.nombre, reseña: texto },
    {
      inapropiada: {
        type: 'noul',
        instructions: '¿La reseña contiene insultos, spam, publicidad o datos personales?',
      },
      tema: {
        type: 'choice',
        instructions: '¿De qué trata la reseña?',
        criteria: {
          producto: 'Opina sobre el producto, su calidad o su uso',
          envio: 'Habla solo del envío o de la entrega',
          otro: 'No tiene relación con el producto ni con la compra',
        },
      },
      nota: {
        type: 'score',
        instructions: '¿Qué valoración le da el cliente al producto?',
        criteria: ['Muy mala', 'Mala', 'Regular', 'Buena', 'Muy buena'],
      },
    },
  );

  // El código decide con números, no interpretando texto
  if (answers.inapropiada.noul > 0.5) {
    return { publicar: false, motivo: 'contiene contenido inapropiado' };
  }
  if (answers.tema.choice === 'otro' && answers.tema.confidence > 0.6) {
    return { publicar: false, motivo: 'no habla del producto' };
  }

  // score va de 0 a 4 → estrellas de 1 a 5
  return { publicar: true, nota: Math.round(answers.nota.score) + 1 };
}
