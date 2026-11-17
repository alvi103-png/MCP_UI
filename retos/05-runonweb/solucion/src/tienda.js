// Estado y lógica de la tienda. No sabe nada de la interfaz ni de IA:
// la interfaz (main.js) y las herramientas para agentes (webmcp.js) usan estas funciones.
import { categorias, productos } from './productos.js';

export { categorias };

const CLAVE_CARRITO = 'tienda:carrito';

/** Avisa a la interfaz cuando cambia algo: tienda.addEventListener('cambio', …) */
export const tienda = new EventTarget();
const avisar = () => tienda.dispatchEvent(new Event('cambio'));

/** id del producto → cantidad */
const carrito = new Map(JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? '[]'));

/** Filtros que se ven ahora mismo en pantalla */
export let filtros = { texto: '', categoria: '', precioMaximo: undefined };

const normalizar = (texto) =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const valoracion = (producto) =>
  Number((producto.reseñas.reduce((suma, { nota }) => suma + nota, 0) / producto.reseñas.length).toFixed(1));

/** Datos de un producto sin las reseñas, listos para enseñar o enviar a un agente */
const resumen = ({ reseñas, ...producto }) => ({ ...producto, valoracion: valoracion({ reseñas }) });

export function buscarProductos({ texto = '', categoria = '', precioMaximo } = {}) {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);

  return productos
    .filter((producto) => {
      const contenido = normalizar(`${producto.nombre} ${producto.descripcion} ${producto.categoria}`);
      if (!palabras.every((palabra) => contenido.includes(palabra))) return false;
      if (categoria && producto.categoria !== categoria) return false;
      if (precioMaximo && producto.precio > precioMaximo) return false;
      return true;
    })
    .map(resumen);
}

/** Cambia los filtros de la pantalla (para que el usuario vea lo que busca el agente) */
export function filtrar(nuevos = {}) {
  filtros = { texto: '', categoria: '', precioMaximo: undefined, ...nuevos };
  avisar();
  return buscarProductos(filtros);
}

export function obtenerProducto(id) {
  const producto = productos.find((producto) => producto.id === id);
  if (!producto) throw new Error(`No existe ningún producto con el id "${id}"`);
  return { ...producto, valoracion: valoracion(producto) };
}

export function todosLosProductos() {
  return productos.map(resumen);
}

export function añadirReseña(id, reseña) {
  productos.find((producto) => producto.id === id).reseñas.push(reseña);
  avisar();
}

function guardarCarrito() {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify([...carrito]));
  avisar();
}

export function añadirAlCarrito(id, cantidad = 1) {
  obtenerProducto(id); // lanza un error si no existe
  carrito.set(id, (carrito.get(id) ?? 0) + cantidad);
  guardarCarrito();
  return verCarrito();
}

export function quitarDelCarrito(id) {
  carrito.delete(id);
  guardarCarrito();
  return verCarrito();
}

export function vaciarCarrito() {
  carrito.clear();
  guardarCarrito();
  return verCarrito();
}

export function verCarrito() {
  const lineas = [...carrito].map(([id, cantidad]) => {
    const { nombre, precio, imagen } = obtenerProducto(id);
    return { id, nombre, imagen, precio, cantidad, subtotal: precio * cantidad };
  });

  return {
    lineas,
    unidades: lineas.reduce((suma, linea) => suma + linea.cantidad, 0),
    total: lineas.reduce((suma, linea) => suma + linea.subtotal, 0),
  };
}
