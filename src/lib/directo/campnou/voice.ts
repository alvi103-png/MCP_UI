// Modo voz del asistente del Camp Nou.
//
// - El micrófono entra a 16 kHz por un AudioWorklet (PCM en bruto, sin MediaRecorder).
// - Un detector de voz por energía, con suelo de ruido adaptativo, decide cuándo empiezas
//   y cuándo acabas de hablar.
// - Mientras hablas, Whisper (el mismo worker WebGPU de /traductor) re-transcribe la frase
//   entera cada vez que queda libre: el texto aparece en vivo. Al callar, una pasada final.
// - La respuesta del agente se lee con speechSynthesis.

const SAMPLE_RATE = 16_000
/** Muestras por trama del worklet: 32 ms. */
const FRAME = 512
const ms = (n: number) => Math.round((n / 1000) * SAMPLE_RATE)

/** Audio que se guarda antes de detectar voz, para no comerse la primera sílaba. */
const PRE_ROLL = ms(350)
/** Tramas seguidas por encima del umbral para dar por empezada la frase (~96 ms). */
const START_FRAMES = 3
/** Silencio que cierra la frase. */
const END_SILENCE = ms(850)
/** Voz mínima para que la frase cuente (toses, golpes en la mesa…). */
const MIN_VOICE = ms(300)
/** Whisper trabaja con ventanas de 30 s. */
const MAX_UTTERANCE = ms(25_000)
/** Audio nuevo mínimo entre dos transcripciones parciales. */
const PARTIAL_STEP = ms(250)
/** Silencio que se deja al final del audio que va a Whisper. */
const TAIL = ms(200)

export type VoiceState = 'off' | 'loading' | 'listening' | 'hearing' | 'transcribing' | 'busy' | 'speaking'

export type VoiceOptions = {
  onState?: (state: VoiceState) => void
  onProgress?: (pct: number | null, label: string) => void
  /** Nivel del micro de 0 a 1, para animar la interfaz. */
  onLevel?: (level: number) => void
  onSpeechStart?: () => void
  onPartial?: (text: string) => void
  /** Frase terminada. `ms` es lo que tardó la pasada final de Whisper. */
  onFinal?: (text: string, ms: number) => void
  /** La frase era ruido o una alucinación de Whisper. */
  onDiscard?: () => void
  onError?: (message: string) => void
}

type WorkerMessage = {
  status: string
  requestId?: number
  output?: string[] | string
  error?: string
  data?: string
  file?: string
  loaded?: number
  total?: number
}

// Lo que Whisper se inventa cuando oye ruido (sale de los subtítulos con los que se entrenó).
const HALLUCINATIONS =
  /amara\.org|subt[ií]tul|gracias por ver|suscr[ií]bete|like y suscr|^\W*(m[uú]sica|aplausos)\W*$/i

function cleanTranscript(raw: string) {
  return (
    raw
      .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
      .replace(/\s+/g, ' ')
      // Whisper a veces entra en bucle («¿Qué pasa? ¿Qué pasa? ¿Qué pasa?…»): deja una sola copia.
      .replace(/(.{6,}?)(?:\s*\1){2,}/gi, '$1')
      .trim()
  )
}

function isNoise(text: string) {
  return !/[\p{L}\p{N}]/u.test(text) || HALLUCINATIONS.test(text)
}

const WORKLET = `
class CampNouMicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0 }
    }
    return true
  }
}
registerProcessor('camp-nou-mic-tap', CampNouMicTap)
`

function concat(chunks: Float32Array[], length?: number) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(Math.min(total, length ?? total))
  let offset = 0
  for (const c of chunks) {
    if (offset >= out.length) break
    const part = c.subarray(0, out.length - offset)
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// ---------------------------------------------------------------------------
// Voz de salida
// ---------------------------------------------------------------------------

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('es'))
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.replace('_', '-').toLowerCase() === 'es-es' ? 4 : 0) +
    (/premium|enhanced|mejorad|neural|natural/i.test(v.name) ? 3 : 0) +
    (/google/i.test(v.name) ? 2 : 0) +
    (v.localService ? 0 : 1)
  return voices.sort((a, b) => score(b) - score(a))[0] ?? null
}

/** Texto apto para leer en voz alta. */
export function toSpeech(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Modo voz
// ---------------------------------------------------------------------------

export function createVoiceMode(options: VoiceOptions = {}) {
  let state: VoiceState = 'off'
  let worker: Worker | null = null
  let modelReady: Promise<void> | null = null

  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null

  // Detector de voz
  let noiseFloor = 0.004
  let loudFrames = 0
  let preRoll: Float32Array[] = []
  let preRollLength = 0
  let utterance: Float32Array[] = []
  let utteranceLength = 0
  let voiced = 0
  let lastVoiceAt = 0
  let lastPartialAt = 0
  let level = 0

  // Whisper
  let requestId = 0
  let transcribing = false
  let latestPartial = ''
  const pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>()

  // Voz de salida
  let speaking: { utterances: SpeechSynthesisUtterance[]; done: () => void } | null = null

  const setState = (next: VoiceState) => {
    if (state === next) return
    state = next
    options.onState?.(next)
  }

  // ----- Whisper ------------------------------------------------------------

  function ensureWorker() {
    if (worker) return worker
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.status === 'complete' || (msg.status === 'error' && msg.requestId != null)) {
        const waiter = pending.get(msg.requestId!)
        if (!waiter) return
        pending.delete(msg.requestId!)
        if (msg.status === 'error') waiter.reject(new Error(msg.error))
        else waiter.resolve(String(Array.isArray(msg.output) ? msg.output[0] ?? '' : msg.output ?? ''))
      }
    })
    return worker
  }

  function loadModel() {
    if (modelReady) return modelReady
    const w = ensureWorker()
    const files = new Map<string, { loaded: number; total: number }>()

    modelReady = new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data
        switch (msg.status) {
          case 'progress': {
            if (!msg.file || !msg.total) break
            files.set(msg.file, { loaded: msg.loaded ?? 0, total: msg.total })
            let loaded = 0
            let total = 0
            for (const f of files.values()) {
              loaded += f.loaded
              total += f.total
            }
            options.onProgress?.(total ? Math.round((loaded / total) * 100) : null, 'Descargando Whisper')
            break
          }
          case 'loading':
            if (msg.data?.startsWith('Compilando')) options.onProgress?.(null, 'Calentando Whisper en la GPU')
            break
          case 'ready':
            w.removeEventListener('message', onMessage)
            resolve()
            break
          case 'error':
            if (msg.requestId != null) break
            w.removeEventListener('message', onMessage)
            modelReady = null
            reject(new Error(msg.error))
            break
        }
      }
      w.addEventListener('message', onMessage)
    })
    options.onProgress?.(null, 'Cargando Whisper')
    w.postMessage({ type: 'load' })
    return modelReady
  }

  function transcribe(audio: Float32Array) {
    const id = ++requestId
    transcribing = true
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Whisper no ha respondido a tiempo.'))
      }, 15_000)
      pending.set(id, {
        resolve: (text) => (clearTimeout(timeout), resolve(text)),
        reject: (err) => (clearTimeout(timeout), reject(err)),
      })
      worker!.postMessage({ type: 'generate', data: { audio, language: 'spanish', requestId: id } })
    }).finally(() => {
      transcribing = false
    })
  }

  async function partial() {
    lastPartialAt = utteranceLength
    const audio = concat(utterance)
    try {
      const text = cleanTranscript(await transcribe(audio))
      // Puede llegar cuando la frase ya se ha cerrado: entonces manda la pasada final.
      if (state !== 'hearing' || !text || isNoise(text)) return
      latestPartial = text
      options.onPartial?.(text)
    } catch {
      // Una parcial perdida no importa: la siguiente la sustituye.
    }
  }

  async function finish() {
    setState('transcribing')
    const voicedEnough = voiced >= MIN_VOICE
    const audio = concat(utterance, Math.min(utteranceLength, lastVoiceAt + TAIL))
    resetUtterance()

    if (!voicedEnough) {
      options.onDiscard?.()
      listen()
      return
    }

    // Espera a que termine la parcial que esté en marcha (el worker hace una cosa a la vez).
    while (transcribing) await new Promise((r) => setTimeout(r, 15))
    if (state !== 'transcribing') return

    const startedAt = performance.now()
    let text = ''
    try {
      text = cleanTranscript(await transcribe(audio))
    } catch (err) {
      // Si la final falla, vale lo último que se vio en pantalla.
      text = latestPartial
      if (!text) {
        options.onError?.(err instanceof Error ? err.message : String(err))
        listen()
        return
      }
    }
    if (state !== 'transcribing') return

    if (!text || isNoise(text)) {
      options.onDiscard?.()
      listen()
      return
    }
    setState('busy')
    options.onFinal?.(text, Math.round(performance.now() - startedAt))
  }

  // ----- Micrófono y detector de voz ---------------------------------------

  function resetUtterance() {
    utterance = []
    utteranceLength = 0
    voiced = 0
    lastVoiceAt = 0
    lastPartialAt = 0
    loudFrames = 0
    latestPartial = ''
  }

  function onFrame(frame: Float32Array) {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
    const rms = Math.sqrt(sum / frame.length)

    // Nivel en escala logarítmica (-60 dB → 0, -10 dB → 1), suavizado.
    const db = 20 * Math.log10(rms + 1e-9)
    level = level * 0.6 + Math.min(1, Math.max(0, (db + 60) / 50)) * 0.4
    options.onLevel?.(level)

    const threshold = Math.max(0.008, noiseFloor * 3.2)
    const loud = rms > threshold

    if (state === 'hearing') {
      utterance.push(frame)
      utteranceLength += frame.length
      if (rms > threshold * 0.6) {
        voiced += frame.length
        lastVoiceAt = utteranceLength
      }
      if (utteranceLength - lastVoiceAt >= END_SILENCE || utteranceLength >= MAX_UTTERANCE) {
        void finish()
        return
      }
      if (!transcribing && utteranceLength - lastPartialAt >= PARTIAL_STEP && voiced >= ms(150)) void partial()
      return
    }

    // Fuera de una frase: el suelo de ruido baja rápido y sube despacio.
    if (!loud) noiseFloor = rms < noiseFloor ? noiseFloor * 0.9 + rms * 0.1 : noiseFloor * 0.995 + rms * 0.005

    preRoll.push(frame)
    preRollLength += frame.length
    while (preRollLength - preRoll[0]!.length >= PRE_ROLL) preRollLength -= preRoll.shift()!.length

    if (state !== 'listening') {
      loudFrames = 0
      return
    }

    loudFrames = loud ? loudFrames + 1 : 0
    if (loudFrames < START_FRAMES) return

    resetUtterance()
    utterance = preRoll
    utteranceLength = preRollLength
    voiced = START_FRAMES * FRAME
    lastVoiceAt = utteranceLength
    preRoll = []
    preRollLength = 0
    setState('hearing')
    options.onSpeechStart?.()
  }

  async function openMic() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no deja usar el micrófono.')
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
    // Safari lo crea suspendido si ya no hay gesto del usuario (tras el permiso del micro).
    await audioContext.resume()
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    try {
      await audioContext.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const source = audioContext.createMediaStreamSource(stream)
    const tap = new AudioWorkletNode(audioContext, 'camp-nou-mic-tap')
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data)
    source.connect(tap)
  }

  function closeMic() {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void audioContext?.close()
    audioContext = null
    preRoll = []
    preRollLength = 0
    level = 0
    options.onLevel?.(0)
  }

  // ----- API ----------------------------------------------------------------

  function listen() {
    if (state === 'off') return
    resetUtterance()
    setState('listening')
  }

  async function start() {
    if (state !== 'off') return
    if (!('gpu' in navigator)) throw new Error('El modo voz necesita WebGPU (Chrome, Edge o Safari 26).')
    setState('loading')
    // Carga las voces de speechSynthesis, que en Chrome llegan tarde.
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices()
    try {
      // El permiso del micro se pide mientras se descarga el modelo.
      await Promise.all([openMic(), loadModel()])
    } catch (err) {
      stop()
      throw err
    }
    // Se salió del modo voz durante la descarga: el micro se abrió tarde, ciérralo.
    if ((state as VoiceState) !== 'loading') {
      closeMic()
      return
    }
    listen()
  }

  function stop() {
    cancelSpeech()
    closeMic()
    resetUtterance()
    setState('off')
  }

  /** Cierra ya la frase en curso, sin esperar al silencio. */
  function commit() {
    if (state === 'hearing') void finish()
  }

  function cancelSpeech() {
    if (!speaking) return
    const { done } = speaking
    speaking = null
    speechSynthesis.cancel()
    done()
  }

  /** Lee el texto en voz alta. Al acabar (o al interrumpir) vuelve a escuchar. */
  function speak(text: string) {
    const clean = toSpeech(text)
    if (state === 'off') return Promise.resolve()
    if (!clean || typeof speechSynthesis === 'undefined') {
      listen()
      return Promise.resolve()
    }

    cancelSpeech()
    setState('speaking')
    const voice = pickSpanishVoice()
    // Frase a frase: Chrome corta las locuciones largas.
    const sentences = clean.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean]

    return new Promise<void>((resolve) => {
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        clearTimeout(safety)
        speaking = null
        // Un respiro para que el micro no recoja el final de la propia voz.
        setTimeout(() => {
          if (state === 'speaking') listen()
          resolve()
        }, 250)
      }
      // Por si speechSynthesis se queda colgado sin disparar onend.
      const safety = setTimeout(() => cancelSpeech(), 4000 + clean.length * 90)

      const utterances = sentences.map((sentence, i) => {
        const u = new SpeechSynthesisUtterance(sentence)
        u.lang = voice?.lang ?? 'es-ES'
        if (voice) u.voice = voice
        u.rate = 1.08
        if (i === sentences.length - 1) u.onend = done
        u.onerror = (e) => {
          if (e.error !== 'interrupted' && e.error !== 'canceled') console.warn('speechSynthesis:', e.error)
          done()
        }
        return u
      })
      // Se guardan para que el recolector de basura no se las coma a mitad (bug de Chrome).
      speaking = { utterances, done }
      for (const u of utterances) speechSynthesis.speak(u)
    })
  }

  return {
    start,
    stop,
    listen,
    commit,
    speak,
    /** Para la voz del asistente y vuelve a escuchar. */
    interrupt: () => {
      cancelSpeech()
      listen()
    },
    /** El agente trabaja: no se escucha hasta que conteste. */
    hold: () => {
      if (state !== 'off') setState('busy')
    },
    get state() {
      return state
    },
  }
}

export type VoiceMode = ReturnType<typeof createVoiceMode>
