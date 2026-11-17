// Bloque 2 · WebMCP: la web expone sus funcionalidades como herramientas.
// Un agente del navegador las llama directamente, sin leer la pantalla ni simular clics.
import {
  añadirAlCarrito,
  categorias,
  filtrar,
  obtenerProducto,
  vaciarCarrito,
  verCarrito,
} from './tienda.js';

/**
 * Registra las herramientas de la tienda. Devuelve los nombres de las registradas.
 * `interfaz` son funciones de main.js para que el usuario vea lo que hace el agente.
 */
export async function registrarHerramientas(interfaz) {
  // La API vive en document.modelContext (en versiones antiguas, navigator.modelContext)
  const modelContext = document.modelContext ?? navigator.modelContext;

  if (!modelContext) {
    console.info('WebMCP no está disponible. Actívalo en chrome://flags/#enable-webmcp-testing');
    return [];
  }

  const herramientas = [
    {
      name: 'buscar_productos',
      description:
        'Busca productos en el catálogo de la tienda por texto, categoría y precio máximo. Devuelve id, nombre, precio en euros y valoración. La búsqueda también se muestra al usuario en pantalla.',
      inputSchema: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Palabras que deben aparecer en el nombre o la descripción' },
          categoria: { type: 'string', enum: categorias, description: 'Categoría del producto' },
          precioMaximo: { type: 'number', description: 'Precio máximo en euros' },
        },
      },
      annotations: { readOnlyHint: true },
      execute(filtros) {
        interfaz.ocultarRecomendados();
        const productos = filtrar(filtros);
        return { total: productos.length, productos };
      },
    },
    {
      name: 'ver_producto',
      description: 'Devuelve el detalle de un producto, incluidas las reseñas de los clientes, y lo abre en pantalla.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Identificador del producto, por ejemplo "mochila-viaje"' } },
        required: ['id'],
      },
      // Las reseñas las escriben los usuarios: el agente no debe fiarse de ellas
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute({ id }) {
        const producto = obtenerProducto(id);
        interfaz.abrirDetalle(id);
        return producto;
      },
    },
    {
      name: 'anadir_al_carrito',
      description: 'Añade unidades de un producto al carrito. Devuelve el carrito actualizado con el total en euros.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Identificador del producto' },
          cantidad: { type: 'integer', minimum: 1, maximum: 10, description: 'Unidades que añadir (1 por defecto)' },
        },
        required: ['id'],
      },
      execute({ id, cantidad = 1 }) {
        return añadirAlCarrito(id, cantidad);
      },
    },
    {
      name: 'ver_carrito',
      description: 'Devuelve los productos del carrito, las unidades y el total en euros.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute() {
        return verCarrito();
      },
    },
    {
      name: 'vaciar_carrito',
      description: 'Elimina todos los productos del carrito. No se puede deshacer.',
      inputSchema: { type: 'object', properties: {} },
      // Acción con consecuencias: el navegador puede pedir confirmación al usuario
      annotations: { consequentialHint: true },
      execute() {
        return vaciarCarrito();
      },
    },
  ];

  const registradas = [];

  for (const herramienta of herramientas) {
    const { execute } = herramienta;

    await modelContext.registerTool({
      ...herramienta,
      // Los errores se devuelven como valor: el mensaje de una excepción no llega al agente
      async execute(parametros) {
        try {
          return await execute(parametros);
        } catch (error) {
          return { error: error.message };
        }
      },
    });

    registradas.push(herramienta.name);
  }

  return registradas;
}
