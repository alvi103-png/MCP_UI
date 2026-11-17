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
 * `interfaz` son funciones de main.js para que el usuario vea lo que hace el agente:
 *   interfaz.abrirDetalle(id)       → abre la ficha de un producto
 *   interfaz.ocultarRecomendados()  → vuelve al listado normal
 */
export async function registrarHerramientas(interfaz) {
  // TODO 1: comprueba que el navegador tiene WebMCP.
  //   La API vive en document.modelContext. Si no existe, devuelve [] para que
  //   la tienda siga funcionando igual que siempre.
  const modelContext = undefined;

  if (!modelContext) {
    console.info('WebMCP no está disponible. Actívalo en chrome://flags/#enable-webmcp-testing');
    return [];
  }

  const herramientas = [
    // Ejemplo completo: una herramienta de solo lectura sin parámetros
    {
      name: 'ver_carrito',
      description: 'Devuelve los productos del carrito, las unidades y el total en euros.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute() {
        return verCarrito();
      },
    },

    // TODO 2: `buscar_productos` (texto, categoria, precioMaximo).
    //   - Describe bien cada parámetro en inputSchema (es un JSON Schema).
    //     Para la categoría usa `enum: categorias`.
    //   - En execute usa filtrar(filtros): devuelve los productos y además
    //     actualiza la pantalla para que el usuario vea la búsqueda.
    //   - Es de solo lectura: annotations: { readOnlyHint: true }

    // TODO 3: `anadir_al_carrito` (id obligatorio, cantidad opcional).
    //   - Usa añadirAlCarrito(id, cantidad) y devuelve el carrito actualizado.

    // TODO 4: `ver_producto` (id).
    //   - Usa obtenerProducto(id) e interfaz.abrirDetalle(id).
    //   - Devuelve reseñas escritas por usuarios: márcalo con
    //     annotations: { readOnlyHint: true, untrustedContentHint: true }

    // TODO 5: `vaciar_carrito`.
    //   - No se puede deshacer: annotations: { consequentialHint: true }
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

// TODO 6 (API declarativa): abre index.html y convierte el formulario de ofertas
// en una herramienta sin escribir JavaScript:
//   <form id="ofertas" toolname="suscribir_ofertas" tooldescription="…">
//   y en cada campo: toolparamdescription="…"
