// Interfaz de la tienda. No hace falta tocar este archivo durante el taller:
// el trabajo de cada bloque está en webmcp.js, jev.js e ia-local.js.
import { resumirReseñas } from './ia-local.js';
import { busquedaInteligente, moderarReseña } from './jev.js';
import {
  añadirAlCarrito,
  añadirReseña,
  buscarProductos,
  categorias,
  filtrar,
  filtros,
  obtenerProducto,
  quitarDelCarrito,
  tienda,
  vaciarCarrito,
  verCarrito,
} from './tienda.js';
import { registrarHerramientas } from './webmcp.js';

const $ = (selector, raiz = document) => raiz.querySelector(selector);

const $filtros = $('#filtros');
const $inteligente = $('#inteligente');
const $productos = $('#productos');
const $estado = $('#estado');
const $lineas = $('#lineas');
const $total = $('#total');
const $detalle = $('#detalle');
const $contenido = $('#detalle-contenido');
const $ofertas = $('#ofertas');

const euros = (cantidad) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cantidad);

/** Crea un elemento: h('p', { className: 'x' }, 'texto', otroElemento) */
function h(etiqueta, propiedades = {}, ...hijos) {
  const $elemento = Object.assign(document.createElement(etiqueta), propiedades);
  $elemento.append(...hijos.filter((hijo) => hijo !== null && hijo !== undefined && hijo !== false));
  return $elemento;
}

/** Resultado de la última búsqueda inteligente: [{ producto, encaje }] o null */
let recomendados = null;

// ── Catálogo ──────────────────────────────────────────────────────────────

function pintarProductos() {
  const lista = recomendados ?? buscarProductos(filtros).map((producto) => ({ producto }));

  if (!recomendados) {
    $estado.textContent = `${lista.length} ${lista.length === 1 ? 'producto' : 'productos'}`;
  }

  $productos.replaceChildren(
    ...lista.map(({ producto, encaje }) =>
      h(
        'li',
        { className: 'producto' },
        h('span', { className: 'emoji', ariaHidden: 'true' }, producto.emoji),
        h('h3', {}, producto.nombre),
        h('p', { className: 'descripcion' }, producto.descripcion),
        encaje !== undefined && h('p', { className: 'encaje' }, `Encaje: ${Math.round(encaje * 100)} %`),
        h('p', { className: 'pie' }, h('strong', {}, euros(producto.precio)), h('span', {}, `★ ${producto.valoracion}`)),
        h(
          'div',
          { className: 'acciones' },
          h('button', { type: 'button', onclick: () => abrirDetalle(producto.id) }, 'Ver'),
          h('button', { type: 'button', className: 'principal', onclick: () => añadirAlCarrito(producto.id) }, 'Añadir'),
        ),
      ),
    ),
  );
}

function pintarFiltros() {
  $filtros.texto.value = filtros.texto ?? '';
  $filtros.categoria.value = filtros.categoria ?? '';
  $filtros.precioMaximo.value = filtros.precioMaximo ?? '';
}

$filtros.addEventListener('input', () => {
  recomendados = null;
  filtrar({
    texto: $filtros.texto.value,
    categoria: $filtros.categoria.value,
    precioMaximo: Number($filtros.precioMaximo.value) || undefined,
  });
});

$filtros.addEventListener('submit', (evento) => evento.preventDefault());

// ── Carrito ───────────────────────────────────────────────────────────────

function pintarCarrito() {
  const { lineas, total } = verCarrito();

  $lineas.replaceChildren(
    ...(lineas.length
      ? lineas.map((linea) =>
          h(
            'li',
            {},
            h('span', {}, `${linea.cantidad} × ${linea.nombre}`),
            h('span', {}, euros(linea.subtotal)),
            h('button', { type: 'button', ariaLabel: `Quitar ${linea.nombre}`, onclick: () => quitarDelCarrito(linea.id) }, '×'),
          ),
        )
      : [h('li', { className: 'vacio' }, 'Todavía no hay nada.')]),
  );
  $total.textContent = euros(total);
}

$('#vaciar').addEventListener('click', () => vaciarCarrito());

// ── Bloque 3 · Búsqueda inteligente con Jev ───────────────────────────────

$inteligente.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const $boton = $('button', $inteligente);
  const peticion = $inteligente.peticion.value.trim();

  $boton.disabled = true;
  $estado.textContent = 'Jev está decidiendo…';
  const inicio = performance.now();

  try {
    recomendados = await busquedaInteligente(peticion);
    const milisegundos = Math.round(performance.now() - inicio);
    $estado.textContent = `${recomendados.length} recomendados para «${peticion}» · ${milisegundos} ms`;
    pintarProductos();
  } catch (error) {
    $estado.textContent = error.message;
  } finally {
    $boton.disabled = false;
  }
});

// ── Detalle del producto: reseñas, resumen local y moderación ─────────────

function abrirDetalle(id) {
  const producto = obtenerProducto(id);

  const $resumen = h('p', { className: 'resumen', role: 'status' });
  const $resumir = h('button', { type: 'button' }, 'Resumir reseñas en local');

  // Bloque 4 · IA en el navegador
  $resumir.addEventListener('click', async () => {
    $resumir.disabled = true;
    $resumen.textContent = 'Preparando el modelo…';
    try {
      const { texto, motor } = await resumirReseñas(producto, {
        alProgresar: (porcentaje) => ($resumen.textContent = `Descargando el modelo… ${porcentaje} %`),
        alEscribir: (parcial) => ($resumen.textContent = parcial),
      });
      $resumen.textContent = `${texto}\n\n— ${motor}`;
    } catch (error) {
      $resumen.textContent = error.message;
    } finally {
      $resumir.disabled = false;
    }
  });

  const $aviso = h('p', { className: 'estado', role: 'status' });
  const $formulario = h(
    'form',
    { className: 'nueva-reseña' },
    h('label', {}, h('span', {}, 'Tu nombre'), h('input', { name: 'autor', required: true, autocomplete: 'off' })),
    h('label', {}, h('span', {}, 'Tu reseña'), h('textarea', { name: 'texto', rows: 3, required: true })),
    h('button', { type: 'submit' }, 'Publicar reseña'),
    $aviso,
  );

  // Bloque 3 · Jev decide si la reseña se publica
  $formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const $boton = $('button', $formulario);
    const autor = $formulario.autor.value.trim();
    const texto = $formulario.texto.value.trim();

    $boton.disabled = true;
    $aviso.textContent = 'Revisando la reseña…';
    try {
      const decision = await moderarReseña(texto, producto);
      if (!decision.publicar) {
        $aviso.textContent = `No se ha publicado: ${decision.motivo}.`;
        return;
      }
      añadirReseña(producto.id, { autor, nota: decision.nota, texto });
      abrirDetalle(producto.id);
    } catch (error) {
      $aviso.textContent = error.message;
    } finally {
      $boton.disabled = false;
    }
  });

  $contenido.replaceChildren(
    h('span', { className: 'emoji', ariaHidden: 'true' }, producto.emoji),
    h('h2', {}, producto.nombre),
    h('p', { className: 'suave' }, producto.descripcion),
    h('p', {}, h('strong', {}, euros(producto.precio)), ` · ★ ${producto.valoracion}`),
    h('h3', {}, `Reseñas (${producto.reseñas.length})`),
    $resumir,
    $resumen,
    h(
      'ul',
      { className: 'reseñas' },
      ...producto.reseñas.map((reseña) =>
        h('li', {}, h('p', { className: 'autor' }, `${reseña.autor} · ${'★'.repeat(reseña.nota)}`), h('p', {}, reseña.texto)),
      ),
    ),
    h('h3', {}, 'Escribe una reseña'),
    $formulario,
  );

  if (!$detalle.open) $detalle.showModal();
}

// ── Ofertas (formulario que también se expone a los agentes) ──────────────

$ofertas.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const mensaje = `Te avisaremos en ${$ofertas.email.value} de las ofertas de ${$ofertas.categoria.value}.`;
  $('#ofertas-estado').textContent = mensaje;

  // WebMCP: si el formulario lo ha enviado un agente, le devolvemos el resultado
  if (evento.agentInvoked) evento.respondWith(Promise.resolve(mensaje));
});

// ── Arranque ──────────────────────────────────────────────────────────────

for (const categoria of categorias) {
  $filtros.categoria.append(h('option', { value: categoria }, categoria));
}

tienda.addEventListener('cambio', () => {
  pintarFiltros();
  pintarProductos();
  pintarCarrito();
});

pintarProductos();
pintarCarrito();

// Bloque 2 · WebMCP
const herramientas = await registrarHerramientas({
  abrirDetalle,
  mostrarRecomendados(lista, peticion) {
    recomendados = lista;
    $estado.textContent = `${lista.length} recomendados para «${peticion}» (búsqueda de un agente)`;
    pintarProductos();
  },
  ocultarRecomendados() {
    recomendados = null;
  },
});

const $agente = $('#agente');
$agente.hidden = false;
$agente.textContent = herramientas.length
  ? `WebMCP: ${herramientas.length} herramientas expuestas`
  : 'WebMCP: sin herramientas';
