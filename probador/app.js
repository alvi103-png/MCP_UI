// Probador: lista las herramientas del servidor MCP, las llama y, si tienen vista (MCP Apps), la pinta.
// Sin SDK: MCP por HTTP es un POST con JSON-RPC, y una vista es un iframe que habla por postMessage.
const ENDPOINT = '/mcp';

const $ = (selector) => document.querySelector(selector);

/** Crea un elemento: h('p', { className: 'x' }, 'texto', otroElemento) */
function h(etiqueta, propiedades = {}, ...hijos) {
  const $elemento = Object.assign(document.createElement(etiqueta), propiedades);
  $elemento.append(...hijos.filter((hijo) => hijo != null && hijo !== false && hijo !== ''));
  return $elemento;
}

/* ───────────── Cliente MCP mínimo ───────────── */

let ultimoId = 0;

async function mcp(method, params = {}) {
  const id = ++ultimoId;
  const respuesta = await fetch(ENDPOINT, {
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

  $resultado.replaceChildren(
    $meta,
    ...(html
      ? [montarVista(html, argumentos, resultado, $resultado.vista.signal), h('details', {}, h('summary', {}, 'content'), $texto)]
      : [$texto]),
    $datos,
  );
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

function montarVista(html, argumentos, resultado, signal) {
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
      return {};
    },
    'ui/message': (params) => {
      anotar('ui/message', textoDe(params));
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

/* ───────────── Arranque ───────────── */

const $estado = $('#estado');
$('#endpoint').textContent = `${location.host}${ENDPOINT}`;

try {
  const { serverInfo } = await mcp('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'probador', version: '1.0.0' },
  });
  $('#servidor').replaceChildren(serverInfo.name, ' ', h('small', {}, serverInfo.version));
  document.title = `${serverInfo.name} · Probador MCP`;

  // Sin herramientas registradas, el servidor ni siquiera entiende tools/list
  const { tools } = await mcp('tools/list').catch(() => ({ tools: [] }));
  $estado.textContent = tools.length
    ? `${tools.length} ${tools.length === 1 ? 'herramienta' : 'herramientas'}`
    : 'Sin herramientas todavía.';
  $('#herramientas').replaceChildren(...tools.map(pintarHerramienta));
} catch (error) {
  $estado.textContent = `El servidor no responde: ${error.message}`;
  $estado.className = 'error';
}
