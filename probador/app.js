// Probador: un chat con un modelo que usa las herramientas del servidor MCP, y debajo las mismas
// herramientas para llamarlas a mano. Si tienen vista (MCP Apps), la pinta.
// Sin SDK: MCP por HTTP es un POST con JSON-RPC, y una vista es un iframe que habla por postMessage.
import { marked } from '/marked.js';

// En /solucion/, el probador habla con el servidor de la carpeta solucion (la pestaña «Ver solución»)
const SOLUCION = location.pathname.startsWith('/solucion/');
const ENDPOINT = SOLUCION ? '/solucion/mcp' : '/mcp';
const MODELO = 'gpt-6-luna';

const $ = (selector) => document.querySelector(selector);

/** Crea un elemento: h('p', { className: 'x' }, 'texto', otroElemento) */
function h(etiqueta, propiedades = {}, ...hijos) {
  const $elemento = Object.assign(document.createElement(etiqueta), propiedades);
  $elemento.append(...hijos.filter((hijo) => hijo != null && hijo !== false && hijo !== ''));
  return $elemento;
}

/* ───────────── Cliente MCP mínimo ───────────── */

let ultimoId = 0;

async function mcp(method, params = {}, endpoint = ENDPOINT) {
  const id = ++ultimoId;
  const respuesta = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const texto = await respuesta.text();
  const tipo = respuesta.headers.get('content-type') ?? '';

  // La respuesta llega como JSON o como eventos SSE ("data: {…}")
  const mensajes = tipo.includes('text/event-stream')
    ? texto.split('\n').filter((linea) => linea.startsWith('data:')).map((linea) => JSON.parse(linea.slice(5)))
    : tipo.includes('json')
      ? [JSON.parse(texto)]
      : [];

  const mensaje = mensajes.find((m) => m.id === id) ?? mensajes.find((m) => m.error);
  if (!mensaje) throw new Error(`HTTP ${respuesta.status}`);
  if (mensaje.error) throw new Error(mensaje.error.message);
  return mensaje.result;
}

/* ───────────── Formulario de cada herramienta (a partir de su inputSchema) ───────────── */

const esNumero = (esquema) => ['number', 'integer'].includes(esquema.type);

// 'por ejemplo "Barça", "Atleti"…' → 'Barça'
const ejemplo = (descripcion = '') => descripcion.match(/por ejemplo "([^"]+)"/)?.[1] ?? '';

function campo(nombre, esquema, requerido) {
  const valor = String(esquema.default ?? (requerido ? ejemplo(esquema.description) : ''));

  const $control = esquema.enum
    ? h(
        'select',
        { name: nombre },
        !requerido && h('option', { value: '' }, '—'),
        ...esquema.enum.map((opcion) => h('option', { value: opcion }, opcion)),
      )
    : h('input', {
        name: nombre,
        type: esNumero(esquema) ? 'number' : 'text',
        step: esquema.type === 'integer' ? '1' : 'any',
        required: requerido,
        autocomplete: 'off',
        spellcheck: false,
      });

  if (valor) $control.value = valor;
  $control.title = esquema.description ?? '';
  return h('label', {}, h('span', {}, nombre), $control);
}

function leerArgumentos($form, esquema) {
  const argumentos = {};
  for (const [nombre, propiedad] of Object.entries(esquema?.properties ?? {})) {
    const valor = $form.querySelector(`[name="${CSS.escape(nombre)}"]`).value.trim();
    if (valor !== '') argumentos[nombre] = esNumero(propiedad) ? Number(valor) : valor;
  }
  return argumentos;
}

function pintarHerramienta(herramienta) {
  const { name, description, inputSchema } = herramienta;
  const requeridos = inputSchema?.required ?? [];
  const $resultado = h('div', { className: 'resultado', hidden: true });
  const $boton = h('button', { type: 'submit' }, 'Probar ▸');

  const $form = h(
    'form',
    {},
    h('code', { className: 'nombre' }, name),
    ...Object.entries(inputSchema?.properties ?? {}).map(([nombre, esquema]) =>
      campo(nombre, esquema, requeridos.includes(nombre)),
    ),
    $boton,
  );

  $form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $boton.disabled = true;
    await probar(herramienta, leerArgumentos($form, inputSchema), $resultado);
    $boton.disabled = false;
  });

  return h('li', { className: 'herramienta' }, $form, h('p', { className: 'descripcion muted' }, description ?? ''), $resultado);
}

/* ───────────── Llamar a una herramienta y pintar lo que devuelve ───────────── */

const textoDe = ({ content = [] } = {}) => content.map((bloque) => bloque.text ?? `[${bloque.type}]`).join('\n');

async function leerVista(uri) {
  try {
    const { contents } = await mcp('resources/read', { uri });
    return contents?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function probar(herramienta, argumentos, $resultado) {
  // Si había una vista de una llamada anterior, deja de escucharla
  $resultado.vista?.abort();
  $resultado.vista = new AbortController();
  $resultado.hidden = false;
  $resultado.replaceChildren(h('p', { className: 'meta muted' }, 'Llamando…'));

  const inicio = performance.now();
  let resultado;
  try {
    resultado = await mcp('tools/call', { name: herramienta.name, arguments: argumentos });
  } catch (error) {
    resultado = { isError: true, content: [{ type: 'text', text: error.message }] };
  }
  const milisegundos = Math.round(performance.now() - inicio);

  const uri = herramienta._meta?.ui?.resourceUri;
  const html = uri && !resultado.isError ? await leerVista(uri) : null;

  const $meta = h(
    'p',
    { className: 'meta' },
    resultado.isError ? h('span', { className: 'error' }, '✕ isError') : h('span', { className: 'ok' }, '✓ ok'),
    h('span', { className: 'muted' }, `${milisegundos} ms`),
    uri && h('code', { className: html ? 'muted' : 'error' }, html ? uri : `${uri} no registrado`),
  );

  const $texto = h('pre', {}, textoDe(resultado) || '(sin texto)');
  const $datos =
    resultado.structuredContent &&
    h('details', {}, h('summary', {}, 'structuredContent'), h('pre', {}, JSON.stringify(resultado.structuredContent, null, 2)));

  const $partes = html
    ? [montarVista(html, argumentos, resultado, $resultado.vista.signal), h('details', {}, h('summary', {}, 'content'), $texto)]
    : [$texto];

  // Sin structuredContent, $datos es undefined (y replaceChildren lo pintaría como texto)
  $resultado.replaceChildren($meta, ...$partes, ...($datos ? [$datos] : []));
}

/* ───────────── Cliente de MCP Apps mínimo: la vista en un iframe aislado ───────────── */

// Variables de estilo que el cliente comparte con la vista: los colores de la web del taller
const ESTILOS = {
  '--color-background-primary': '#0a0a0a',
  '--color-background-secondary': '#111111',
  '--color-text-primary': '#ededed',
  '--color-text-secondary': '#8f8f8f',
  '--color-border-tertiary': '#262626',
  '--font-sans': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  '--border-radius-md': '6px',
};

// En el chat, lo que la vista le cuenta al modelo (alContexto) o escribe en el chat (alMensaje) llega de verdad
function montarVista(html, argumentos, resultado, signal, { alContexto, alMensaje } = {}) {
  const $iframe = h('iframe', { title: 'Vista', srcdoc: html });
  $iframe.setAttribute('sandbox', 'allow-scripts allow-forms');

  // Lo que la vista le pide al cliente, para ver que cada paso funciona
  const $eventos = h('ul', { className: 'eventos' });
  const anotar = (metodo, detalle) => $eventos.append(h('li', {}, h('code', {}, metodo), h('span', {}, detalle)));

  const enviar = (mensaje) => $iframe.contentWindow?.postMessage({ jsonrpc: '2.0', ...mensaje }, '*');

  const peticiones = {
    'ui/initialize': ({ protocolVersion }) => ({
      protocolVersion,
      hostInfo: { name: 'probador', version: '1.0.0' },
      hostCapabilities: {
        serverTools: {},
        serverResources: {},
        logging: {},
        openLinks: {},
        updateModelContext: { text: {} },
        message: { text: {} },
      },
      hostContext: {
        theme: 'dark',
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        platform: 'web',
        locale: 'es-ES',
        styles: { variables: ESTILOS },
      },
    }),
    'tools/call': (params) => {
      anotar('tools/call', `${params.name} ${JSON.stringify(params.arguments ?? {})}`);
      return mcp('tools/call', params);
    },
    'resources/read': (params) => mcp('resources/read', params),
    'ui/update-model-context': (params) => {
      anotar('ui/update-model-context', textoDe(params));
      alContexto?.(textoDe(params));
      return {};
    },
    'ui/message': (params) => {
      anotar('ui/message', textoDe(params));
      alMensaje?.(textoDe(params));
      return {};
    },
    'ui/open-link': ({ url }) => {
      window.open(url, '_blank', 'noopener');
      return {};
    },
    ping: () => ({}),
  };

  const notificaciones = {
    // La vista está lista: le pasamos los argumentos y el resultado de la herramienta
    'ui/notifications/initialized': () => {
      enviar({ method: 'ui/notifications/tool-input', params: { arguments: argumentos } });
      enviar({ method: 'ui/notifications/tool-result', params: resultado });
    },
    'ui/notifications/size-changed': ({ height }) => {
      if (height) $iframe.style.height = `${Math.ceil(height) + 2}px`;
    },
    'notifications/message': ({ level, data }) =>
      anotar(`log · ${level}`, typeof data === 'string' ? data : JSON.stringify(data)),
  };

  window.addEventListener(
    'message',
    async ({ source, data }) => {
      if (source !== $iframe.contentWindow || data?.jsonrpc !== '2.0' || !data.method) return;
      const { id, method, params = {} } = data;

      if (id === undefined) {
        notificaciones[method]?.(params);
        return;
      }

      try {
        if (!peticiones[method]) throw new Error(`El probador no soporta ${method}`);
        enviar({ id, result: await peticiones[method](params) });
      } catch (error) {
        enviar({ id, error: { code: -32603, message: error.message } });
      }
    },
    { signal },
  );

  return h('div', { className: 'resultado' }, $iframe, $eventos);
}

/* ───────────── Las herramientas del servidor (cambian cada vez que descomentas un paso) ───────────── */

const $estado = $('#estado');
let nombreServidor = 'MCP';
let herramientas = null; // null: todavía no se han pedido

async function actualizarHerramientas() {
  let tools;
  try {
    ({ tools } = await mcp('tools/list'));
  } catch (error) {
    // Sin conexión (el servidor se está reiniciando al guardar): se queda lo que había
    if (error instanceof TypeError) return herramientas ?? [];
    // Sin herramientas registradas, el servidor ni siquiera entiende tools/list
    tools = [];
  }

  // Solo se vuelve a pintar si algo ha cambiado, para no borrar lo que ya has probado
  if (JSON.stringify(tools) === JSON.stringify(herramientas)) return herramientas;
  herramientas = tools;

  $estado.textContent = tools.length
    ? `${tools.length} ${tools.length === 1 ? 'herramienta' : 'herramientas'}`
    : 'Sin herramientas todavía.';
  $('#herramientas').replaceChildren(...tools.map(pintarHerramienta));

  $('#disponibles').replaceChildren(
    ...(tools.length
      ? ['El modelo puede usar: ', ...tools.flatMap(({ name }, i) => [i ? ', ' : '', h('code', {}, name)])]
      : ['El modelo no tiene herramientas: solo sabe lo que aprendió al entrenarse.']),
  );
  return tools;
}

/* ───────────── Chat: el modelo decide qué herramientas usar y el probador las llama ───────────── */

// El modelo habla a través del proxy de OpenAI del taller (Responses API) con el token del taller
let configuracion;

const chat = {
  historial: [], // lo que se le manda al modelo en cada vuelta: mensajes, llamadas a herramientas y sus resultados
  contexto: '', // lo que la vista le cuenta al modelo con ui/update-model-context
  vistas: new AbortController(),
  ocupado: false,
};

const MAX_VUELTAS = 6; // veces seguidas que el modelo puede pedir herramientas antes de responder

// Una herramienta MCP es, casi tal cual, una función para el modelo: nombre, descripción y JSON Schema
const aFuncion = ({ name, description, inputSchema }) => ({
  type: 'function',
  name,
  description: description ?? '',
  parameters: inputSchema ?? { type: 'object', properties: {} },
  strict: false,
});

async function llamarAlModelo(tools) {
  configuracion ??= await fetch('/chat.json').then((respuesta) => respuesta.json());
  if (!configuracion.token) throw new Error('Falta el token del taller: pégalo en retos/config.js.');

  const hoy = new Date().toLocaleDateString('es-ES', { dateStyle: 'full', timeZone: 'Europe/Madrid' });
  const instrucciones = [
    `Eres un asistente conectado al servidor MCP «${nombreServidor}». Hoy es ${hoy}.`,
    'Responde en español y en pocas frases. Puedes usar markdown.',
    'Para cualquier dato actual (resultados, clasificaciones, precios, stock…) usa solo las herramientas. ' +
      'Si no tienes una herramienta que te dé ese dato, dilo claramente: no lo inventes ni respondas con lo que recuerdes de tu entrenamiento.',
    chat.contexto && `Lo que el usuario está viendo ahora en la interfaz: ${chat.contexto}`,
  ];

  const respuesta = await fetch(configuracion.api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${configuracion.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      reasoning: { effort: 'low' },
      store: false,
      instructions: instrucciones.filter(Boolean).join('\n'),
      input: chat.historial,
      tools: tools.length ? tools.map(aFuncion) : undefined,
    }),
  });

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error?.message ?? `El modelo ha respondido con un ${respuesta.status}`);
  return datos.output ?? [];
}

const textoDelModelo = (output) =>
  output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((parte) => parte.type === 'output_text')
    .map((parte) => parte.text)
    .join('');

// El markdown del modelo, sin dejarle meter HTML
marked.use({ renderer: { html: () => '' } });

const $mensajes = $('#mensajes');
const $pensando = $('#pensando');
const $pregunta = $('#pregunta');

function añadir($elemento) {
  $mensajes.append($elemento);
  $elemento.scrollIntoView({ block: 'nearest' });
}

function pintarRespuesta(texto) {
  const $respuesta = h('li', { className: 'asistente' });
  $respuesta.innerHTML = marked.parse(texto);
  añadir($respuesta);
}

/** El modelo pide una herramienta: el probador la llama en el servidor MCP y le devuelve el texto */
async function usarHerramienta({ call_id, name, arguments: json }, tools) {
  chat.historial.push({ type: 'function_call', call_id, name, arguments: json });

  let argumentos = {};
  const inicio = performance.now();
  let resultado;
  try {
    argumentos = JSON.parse(json || '{}');
    resultado = await mcp('tools/call', { name, arguments: argumentos });
  } catch (error) {
    resultado = { isError: true, content: [{ type: 'text', text: error.message }] };
  }
  const milisegundos = Math.round(performance.now() - inicio);

  chat.historial.push({ type: 'function_call_output', call_id, output: textoDe(resultado) || '(sin texto)' });

  const uri = tools.find((tool) => tool.name === name)?._meta?.ui?.resourceUri;
  const html = uri && !resultado.isError ? await leerVista(uri) : null;

  añadir(
    h(
      'li',
      { className: 'llamada' },
      h(
        'p',
        { className: 'meta' },
        resultado.isError ? h('span', { className: 'error' }, '✕') : h('span', { className: 'ok' }, '✓'),
        h('code', {}, `${name}(${Object.keys(argumentos).length ? JSON.stringify(argumentos) : ''})`),
        h('span', { className: 'muted' }, `${milisegundos} ms`),
      ),
      html &&
        montarVista(html, argumentos, resultado, chat.vistas.signal, {
          alContexto: (texto) => (chat.contexto = texto),
          alMensaje: enviarAlChat,
        }),
      h('details', {}, h('summary', {}, 'Lo que recibe el modelo'), h('pre', {}, textoDe(resultado) || '(sin texto)')),
    ),
  );
}

async function conversar(texto) {
  chat.ocupado = true;
  $pregunta.elements.texto.disabled = true;
  $('#nueva').disabled = true;
  $pensando.hidden = false;

  añadir(h('li', { className: 'usuario' }, texto));
  chat.historial.push({ role: 'user', content: texto });

  try {
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      // En cada vuelta, las herramientas que tenga el servidor ahora mismo
      const tools = await actualizarHerramientas();
      const output = await llamarAlModelo(tools);

      const respuesta = textoDelModelo(output);
      if (respuesta) {
        chat.historial.push({ role: 'assistant', content: respuesta });
        pintarRespuesta(respuesta);
      }

      const llamadas = output.filter((item) => item.type === 'function_call');
      if (llamadas.length === 0) break;
      for (const llamada of llamadas) await usarHerramienta(llamada, tools);
    }
  } catch (error) {
    añadir(h('li', { className: 'error' }, `✕ ${error.message}`));
  } finally {
    chat.ocupado = false;
    $pensando.hidden = true;
    $('#nueva').disabled = false;
    $pregunta.elements.texto.disabled = false;
    $pregunta.elements.texto.focus();
  }
}

// En cola: el botón «Pregúntale al asistente» de una vista puede escribir mientras el modelo aún responde
let cola = Promise.resolve();
function enviarAlChat(texto) {
  cola = cola.then(() => conversar(texto));
  return cola;
}

$pregunta.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const texto = $pregunta.elements.texto.value.trim();
  if (!texto || chat.ocupado) return;
  $pregunta.reset();
  enviarAlChat(texto);
});

$('#nueva').addEventListener('click', () => {
  chat.vistas.abort();
  Object.assign(chat, { historial: [], contexto: '', vistas: new AbortController() });
  $mensajes.replaceChildren();
  $pregunta.elements.texto.focus();
});

/* ───────────── Pestañas «Tu código» y «Ver solución» ───────────── */

// Solo aparecen si el servidor tiene solución (los retos sí; el directo no)
async function mostrarPestañas(inicializar) {
  const $pestanas = $('#pestanas');
  const tieneSolucion = SOLUCION || (await mcp('initialize', inicializar, '/solucion/mcp').then(() => true, () => false));
  if (!tieneSolucion) return;

  for (const $pestana of $pestanas.querySelectorAll('a')) {
    if ($pestana.pathname === location.pathname) $pestana.setAttribute('aria-current', 'page');
  }
  $pestanas.hidden = false;
}

/* ───────────── Arranque ───────────── */

const INICIALIZAR = {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'probador', version: '1.0.0' },
};

mostrarPestañas(INICIALIZAR);

$('#endpoint').textContent = `${location.host}${ENDPOINT}`;
$('#modelo').textContent = `· ${MODELO}`;
$pensando.textContent = `${MODELO} está pensando…`;

try {
  const { serverInfo } = await mcp('initialize', INICIALIZAR);
  nombreServidor = serverInfo.name;
  $('#servidor').replaceChildren(serverInfo.name, ' ', h('small', {}, serverInfo.version));
  document.title = `${SOLUCION ? 'Solución · ' : ''}${serverInfo.name} · Probador MCP`;

  await actualizarHerramientas();
  // Al volver del editor tras descomentar un paso, la lista ya está al día
  window.addEventListener('focus', actualizarHerramientas);
} catch (error) {
  $estado.textContent = `El servidor no responde: ${error.message}`;
  $estado.className = 'error';
}
