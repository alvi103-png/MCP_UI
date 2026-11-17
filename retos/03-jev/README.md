---
title: Jev
bloque: 3
minutos: 15
resumen: Decisiones rápidas y estructuradas para la tienda, con una búsqueda inteligente que puntúa el catálogo y un moderador de reseñas.
---

## Objetivo

Muchas veces no necesitas que un modelo *escriba*: necesitas que **decida**. ¿Este producto encaja con lo que busca el cliente? ¿Esta reseña es spam? Con un modelo generativo tendrías que pedir un JSON, esperar y cruzar los dedos.

**Jev** (de TypeSafe) responde preguntas sobre un contenido con datos que tu código usa tal cual:

| Tipo | Pregunta | Respuesta |
| --- | --- | --- |
| `choice` | Elige una opción | `choice: 'envio'`, `confidence`, `probabilities` |
| `score` | Puntúa en una escala | `score: 1.7` (media ponderada de los niveles) |
| `noul` | ¿Sí o no? | `noul: 0.93` (probabilidad de «sí») |

Vas a añadir dos funciones a la tienda: **búsqueda inteligente** y **moderación de reseñas**.

## Arranca

```bash
cd retos/03-jev/inicio
npm install
npm run dev        # http://localhost:5173
```

`src/config.js` ya trae el token del taller:

```js
export const API_URL = 'https://upskilling-mwc-taller.midudev.workers.dev';
export const TOKEN = 'mwc-barcelona-2026';
```

Tienes todos los detalles de la API en [/apis](/apis#jev).

## Pasos

Todo el trabajo está en `src/jev.js`.

### 1. La llamada a Jev

Completa `preguntarAJev(state, questions)`:

```js
const respuesta = await fetch(`${API_URL}/api/jev`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ state, questions }),
});

const datos = await respuesta.json();
if (!respuesta.ok) throw new Error(`Jev ha respondido ${respuesta.status}`);
return datos.answers;
```

- `state`: el contenido sobre el que se pregunta (texto u objeto).
- `questions`: un objeto. Cada clave es el nombre que tú eliges; la respuesta vuelve con esa misma clave.

### 2. Búsqueda inteligente

El cliente escribe «un regalo para alguien que teletrabaja, por menos de 60 €». Hazle a Jev **una pregunta `score` por producto, todas en la misma llamada**:

```js
questions[producto.id] = {
  type: 'score',
  instructions: {
    tarea: '¿Cuánto encaja este producto con la petición del cliente? Ten en cuenta el uso y el presupuesto.',
    producto: { nombre, descripcion, categoria, precio_en_euros: precio },
  },
  criteria: ['No encaja con lo que pide', 'Encaja solo en parte', 'Encaja muy bien con lo que pide'],
};
```

`answers[producto.id].score` va de `0` a `2`. Normalízalo a `0–1`, filtra y ordena. Fíjate en el tiempo que aparece junto a los resultados: doce decisiones en una sola llamada.

### 3. Moderar reseñas

Antes de publicar una reseña, tres preguntas en una llamada:

```js
{
  inapropiada: { type: 'noul', instructions: '¿La reseña contiene insultos, spam, publicidad o datos personales?' },
  tema: {
    type: 'choice',
    instructions: '¿De qué trata la reseña?',
    criteria: {
      producto: 'Opina sobre el producto, su calidad o su uso',
      envio: 'Habla solo del envío o de la entrega',
      otro: 'No tiene relación con el producto ni con la compra',
    },
  },
  nota: { type: 'score', instructions: '¿Qué valoración le da el cliente al producto?',
          criteria: ['Muy mala', 'Mala', 'Regular', 'Buena', 'Muy buena'] },
}
```

Y el código decide con números:

```js
if (answers.inapropiada.noul > 0.5) return { publicar: false, motivo: 'contiene contenido inapropiado' };
```

Pruébalo: abre un producto y escribe una reseña normal, una con publicidad y una que hable de fútbol.

### 4. Extra: la búsqueda inteligente como herramienta WebMCP

Une los bloques 2 y 3: en `src/webmcp.js` registra `busqueda_inteligente` para que un agente del navegador pueda pedir recomendaciones. Usa `interfaz.mostrarRecomendados(lista, peticion)` para que el usuario lo vea.

## Qué te llevas

- **Sin interpretar texto**: nada de `JSON.parse` ni de «responde solo con sí o no».
- **Probabilidades, no solo respuestas**: tú eliges el umbral (`> 0.5`, `> 0.9`…) según lo que cueste equivocarse.
- **Varias preguntas por llamada** sobre el mismo contenido.
- Úsalo para clasificar, enrutar, moderar, ordenar o validar. Para redactar texto sigue haciendo falta un modelo generativo.

¿Te has perdido? La solución está en `retos/03-jev/solucion`.
