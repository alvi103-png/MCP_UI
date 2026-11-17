// Interfaz de /directo/chat. El modelo está en worker.ts; aquí solo se pinta la conversación.
import { Marked } from 'marked';
import type { MensajeChat, Respuesta } from './modelo.ts';

const SISTEMA =
  'Eres un asistente útil que se ejecuta en local, en el navegador del usuario. Responde siempre en español, de forma clara y breve.';
const LADO_MAXIMO = 640; // px: una imagen más grande son más tokens y la respuesta tarda más

interface Mensaje {
  rol: 'user' | 'assistant';
  texto: string;
  imagen?: string;
  /** Las respuestas generadas razonando empiezan dentro del bloque <think> */
  razonar?: boolean;
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const $chat = $('#chat');
const $estado = $('#estado');
const $progreso = $('#progreso');
const $mensajes = $('#mensajes');
const $vacio = $('#vacio');
const $carga = $('#carga');
const $formulario = $<HTMLFormElement>('#formulario');
const $entrada = $<HTMLTextAreaElement>('#entrada');
const $enviar = $<HTMLButtonElement>('#enviar');
const $archivo = $<HTMLInputElement>('#archivo');
const $adjunto = $('#adjunto');
const $razonar = $<HTMLButtonElement>('#razonar');
const $limpiar = $<HTMLButtonElement>('#limpiar');
const $sugerencias = [...document.querySelectorAll<HTMLButtonElement>('[data-sugerencia]')];

let listo = false;
let generando = false;
let razonar = false;
let adjunto: string | null = null;
let historial: Mensaje[] = [];

// ── Markdown: el modelo escribe markdown; el HTML que escriba se muestra como texto ──

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapar(text),
    image: ({ text }) => escapar(text),
    link({ href, tokens }) {
      const texto = this.parser.parseInline(tokens);
      return /^https?:\/\//.test(href) ? `<a href="${escapar(href)}" target="_blank" rel="noopener noreferrer">${texto}</a>` : texto;
    },
  },
});

// ── Estado de la página ──

function mostrarEstado(estado: 'loading' | 'ready' | 'playing' | 'error', texto: string) {
  $estado.dataset.state = estado;
  $estado.textContent = texto;
}

function actualizarControles() {
  $entrada.disabled = !listo;
  $entrada.placeholder = listo ? 'Escribe un mensaje… (Enter envía, Mayús+Enter salta de línea)' : 'Cargando el modelo…';
  $enviar.disabled = !listo || (!generando && !$entrada.value.trim());
  $enviar.textContent = generando ? 'parar ■' : 'enviar ▸';
  $enviar.toggleAttribute('data-parar', generando);
  $razonar.disabled = generando;
  $limpiar.disabled = generando || historial.length === 0;
  for (const $boton of $sugerencias) $boton.disabled = !listo || generando;
}

const cercaDelFinal = () => $mensajes.scrollHeight - $mensajes.scrollTop - $mensajes.clientHeight < 120;
const bajarDelTodo = () => $mensajes.scrollTo({ top: $mensajes.scrollHeight });

// ── El worker ──

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

/** La respuesta que se está generando: cómo repintarla y cómo cerrarla */
let enCurso: ({ mensaje: Mensaje } & ReturnType<typeof pintarAsistente>) | null = null;

worker.addEventListener('message', (evento: MessageEvent<Respuesta>) => {
  const respuesta = evento.data;
  switch (respuesta.estado) {
    case 'cargando':
      mostrarEstado('loading', 'cargando');
      $progreso.style.setProperty('--p', String(respuesta.progreso / 100));
      $carga.textContent = respuesta.texto;
      break;

    case 'listo':
      listo = true;
      mostrarEstado('ready', 'listo');
      $progreso.toggleAttribute('data-oculto', true);
      $carga.textContent = '';
      actualizarControles();
      $entrada.focus({ preventScroll: true });
      break;

    case 'error-carga':
      mostrarEstado('error', 'error');
      $progreso.toggleAttribute('data-oculto', true);
      $carga.textContent = `No se pudo cargar el modelo: ${respuesta.error}. Recarga la página para intentarlo de nuevo.`;
      $carga.classList.add('error');
      break;

    case 'trozo':
      if (!enCurso) return;
      enCurso.mensaje.texto += respuesta.texto;
      enCurso.pintar();
      break;

    case 'fin':
    case 'error': {
      if (!enCurso) return;
      const { mensaje, pintar, terminar } = enCurso;
      enCurso = null;
      generando = false;
      mostrarEstado('ready', 'listo');
      if (respuesta.estado === 'error') {
        mensaje.texto = '';
        pintar();
        terminar(`<span class="error">Error: ${escapar(respuesta.error)}</span>`);
      } else {
        terminar(
          `<strong>${respuesta.tokensPorSegundo.toLocaleString('es-ES')} tok/s</strong> · ${respuesta.tokens} tokens · ` +
            `${(respuesta.milisegundos / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`,
        );
      }
      actualizarControles();
      $entrada.focus({ preventScroll: true });
      break;
    }
  }
});

// ── Pintar mensajes ──

function separar({ texto, razonar }: Mensaje) {
  if (!razonar) return { pensamiento: '', respuesta: texto.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), pensando: false };
  const cierre = texto.indexOf('</think>');
  const pensamiento = (cierre === -1 ? texto : texto.slice(0, cierre)).replace('<think>', '').trim();
  return { pensamiento, respuesta: cierre === -1 ? '' : texto.slice(cierre + '</think>'.length).trim(), pensando: cierre === -1 };
}

function pintarUsuario(mensaje: Mensaje) {
  const $mensaje = document.createElement('article');
  $mensaje.className = 'mensaje usuario';
  if (mensaje.imagen) {
    const $imagen = document.createElement('img');
    $imagen.src = mensaje.imagen;
    $imagen.alt = 'Imagen adjunta';
    $mensaje.append($imagen);
  }
  const $burbuja = document.createElement('p');
  $burbuja.className = 'burbuja';
  $burbuja.textContent = mensaje.texto;
  $mensaje.append($burbuja);
  $mensajes.append($mensaje);
}

function pintarAsistente(mensaje: Mensaje) {
  const $mensaje = document.createElement('article');
  $mensaje.className = 'mensaje asistente';

  const $pensamiento = document.createElement('details');
  $pensamiento.className = 'pensamiento';
  $pensamiento.open = true;
  $pensamiento.hidden = true;
  const $resumen = document.createElement('summary');
  const $razonamiento = document.createElement('p');
  $pensamiento.append($resumen, $razonamiento);

  const $respuesta = document.createElement('div');
  $respuesta.className = 'respuesta escribiendo';

  const $metricas = document.createElement('p');
  $metricas.className = 'metricas';

  $mensaje.append($pensamiento, $respuesta, $metricas);
  $mensajes.append($mensaje);

  let pendiente = false;
  let cerrado = false;
  const pintar = () => {
    if (pendiente) return;
    pendiente = true;
    // Como mucho un repintado por frame, aunque lleguen varios tokens
    requestAnimationFrame(() => {
      pendiente = false;
      const pegado = cercaDelFinal();
      const { pensamiento, respuesta, pensando } = separar(mensaje);

      $pensamiento.hidden = !pensamiento;
      $resumen.textContent = pensando ? 'razonando…' : `razonamiento · ${pensamiento.split(/\s+/).length} palabras`;
      $razonamiento.textContent = pensamiento;
      // Al terminar de razonar se pliega: lo importante es la respuesta
      if (!pensando && pensamiento && !cerrado) {
        cerrado = true;
        $pensamiento.open = false;
      }

      $respuesta.innerHTML = markdown.parse(respuesta, { async: false });
      if (pegado) bajarDelTodo();
    });
  };

  /** Último paso: quita el cursor y añade las métricas (o el error) */
  const terminar = (metricas: string) => {
    requestAnimationFrame(() => {
      $respuesta.classList.remove('escribiendo');
      if (!$respuesta.textContent?.trim() && !$pensamiento.hidden) $pensamiento.open = true;
      $metricas.innerHTML = metricas;
      if (cercaDelFinal()) bajarDelTodo();
    });
  };

  return { pintar, terminar };
}

// ── Enviar ──

function enviar(texto: string) {
  if (!listo || generando || !texto) return;

  const pregunta: Mensaje = { rol: 'user', texto, imagen: adjunto ?? undefined };
  const respuesta: Mensaje = { rol: 'assistant', texto: '', razonar };

  // Lo que ve el modelo: el system prompt y la conversación, sin los razonamientos anteriores.
  // El procesador de Qwen en Transformers.js solo admite una imagen por llamada: va la última.
  const conversacion = [...historial, pregunta];
  const conImagen = conversacion.findLast((mensaje) => mensaje.imagen);
  const mensajes: MensajeChat[] = [{ role: 'system', content: SISTEMA }];
  const imagenes: string[] = [];
  for (const mensaje of conversacion) {
    if (mensaje.rol === 'user') {
      if (mensaje.imagen && mensaje === conImagen) {
        imagenes.push(mensaje.imagen);
        mensajes.push({ role: 'user', content: [{ type: 'image' }, { type: 'text', text: mensaje.texto }] });
      } else {
        mensajes.push({ role: 'user', content: mensaje.texto });
      }
    } else {
      const { respuesta: limpio } = separar(mensaje);
      if (limpio) mensajes.push({ role: 'assistant', content: limpio });
    }
  }

  historial.push(pregunta, respuesta);
  $vacio.hidden = true;
  pintarUsuario(pregunta);
  enCurso = { mensaje: respuesta, ...pintarAsistente(respuesta) };
  enCurso.pintar();
  bajarDelTodo();

  generando = true;
  mostrarEstado('playing', 'generando');
  $entrada.value = '';
  ajustarAltura();
  quitarAdjunto();
  actualizarControles();

  worker.postMessage({ tipo: 'generar', id: crypto.randomUUID(), mensajes, imagenes, razonar });
}

$formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (generando) worker.postMessage({ tipo: 'parar' }); // termina en el siguiente token, con 'fin'
  else enviar($entrada.value.trim());
});

function ajustarAltura() {
  $entrada.style.height = 'auto';
  $entrada.style.height = `${$entrada.scrollHeight}px`;
}

$entrada.addEventListener('input', () => {
  ajustarAltura();
  actualizarControles();
});

$entrada.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' || evento.shiftKey || evento.isComposing) return;
  evento.preventDefault();
  if (!generando) enviar($entrada.value.trim());
});

for (const $boton of $sugerencias) {
  $boton.addEventListener('click', () => enviar($boton.dataset.sugerencia!));
}

// ── Imágenes: botón, arrastrar o pegar ──

function reducir(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    imagen.onload = () => {
      const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(imagen.width * escala);
      lienzo.height = Math.round(imagen.height * escala);
      lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      resolve(lienzo.toDataURL('image/jpeg', 0.9));
    };
    imagen.onerror = () => reject(new Error('No se pudo leer la imagen'));
    imagen.src = url;
  });
}

async function adjuntar(archivo: File | undefined | null) {
  if (!archivo?.type.startsWith('image/')) return;
  adjunto = await reducir(archivo);
  $adjunto.querySelector('img')!.src = adjunto;
  $adjunto.hidden = false;
  $entrada.focus({ preventScroll: true });
}

function quitarAdjunto() {
  adjunto = null;
  $adjunto.hidden = true;
  $archivo.value = '';
}

$archivo.addEventListener('change', () => adjuntar($archivo.files?.[0]));
$adjunto.querySelector('button')!.addEventListener('click', quitarAdjunto);
$entrada.addEventListener('paste', (evento) => {
  const archivo = [...(evento.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (archivo) {
    evento.preventDefault();
    adjuntar(archivo);
  }
});
$chat.addEventListener('dragover', (evento) => {
  evento.preventDefault();
  $formulario.classList.add('arrastrando');
});
$chat.addEventListener('dragleave', (evento) => {
  if (!evento.relatedTarget || !$chat.contains(evento.relatedTarget as Node)) $formulario.classList.remove('arrastrando');
});
$chat.addEventListener('drop', (evento) => {
  evento.preventDefault();
  $formulario.classList.remove('arrastrando');
  adjuntar(evento.dataTransfer?.files[0]);
});

// ── Razonar y limpiar (también con R y L) ──

function alternarRazonar() {
  if (generando) return;
  razonar = !razonar;
  $razonar.setAttribute('aria-pressed', String(razonar));
}

function limpiar() {
  if (generando) return;
  historial = [];
  $mensajes.replaceChildren($vacio);
  $vacio.hidden = false;
  actualizarControles();
}

$razonar.addEventListener('click', alternarRazonar);
$limpiar.addEventListener('click', limpiar);

window.addEventListener('keydown', (evento) => {
  if (evento.metaKey || evento.ctrlKey || evento.altKey) return;
  if ((evento.target as HTMLElement).closest('input, textarea, select')) return;
  if (evento.key === 'r' || evento.key === 'R') alternarRazonar();
  if (evento.key === 'l' || evento.key === 'L') limpiar();
});

// ── Arranque: el modelo se descarga nada más abrir la página ──

if (!navigator.gpu) {
  mostrarEstado('error', 'sin webgpu');
  $carga.textContent = 'Este navegador no tiene WebGPU. Abre la demo en Chrome o Edge de escritorio.';
  $carga.classList.add('error');
  $progreso.toggleAttribute('data-oculto', true);
  worker.terminate();
} else {
  worker.postMessage({ tipo: 'cargar' });
}
