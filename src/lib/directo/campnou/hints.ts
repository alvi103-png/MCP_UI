// Lectura instantánea de la transcripción parcial: mientras hablas, la página ya marca el
// partido, la zona y el número de entradas que entiende, con el precio estimado. Es solo
// una pista visual en local (cero latencia); quien rellena el formulario sigue siendo el
// agente con la herramienta WebMCP.

import { type Fixture, type Zone, ZONES } from './data.ts'

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')

const FIXTURE_WORDS: Record<string, RegExp> = {
  sevilla: /\bsevilla\b/g,
  'manchester-city': /\b(manchester|city|citi|ciry)\b/g,
  'real-madrid': /\b(real madrid|madrid|clasico)\b/g,
  villarreal: /\b(villa ?rr?eal|submarino)\b/g,
  liverpool: /\b(liverpool|liverpul|liverpol)\b/g,
  espanyol: /\b(espanyol|derbi|periquitos?|(contra|el|del) espanol)\b/g,
}

const ZONE_WORDS: Record<string, RegExp> = {
  'palco-vip': /\b(palco|vip|hospitality)\b/g,
  'gol-sud': /\bgol (sud|sur)\b|\bgrada d'?animacio|\banimacio/g,
  'gol-nord': /\bgol (nord|norte)\b/g,
  tribuna: /\btribuna\b/g,
  lateral: /\blateral\b/g,
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
}

const COUNT =
  /\b(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho)\s+(entradas?|asientos?|localidades|personas)\b/g

/** El último que se nombra gana: «el Sevilla… no, mejor el Clásico». */
function lastMatch(text: string, words: Record<string, RegExp>) {
  let best: { id: string; at: number } | null = null
  for (const [id, re] of Object.entries(words)) {
    for (const m of text.matchAll(re)) {
      if (!best || m.index! >= best.at) best = { id, at: m.index! }
    }
  }
  return best?.id
}

export type Hints = {
  fixture?: Fixture
  zone?: Zone
  count?: number
  total?: number
}

export function readHints(transcript: string, fixtures: Fixture[]): Hints {
  const text = normalize(transcript)
  const fixtureId = lastMatch(text, FIXTURE_WORDS)
  const zoneId = lastMatch(text, ZONE_WORDS)

  let count: number | undefined
  for (const m of text.matchAll(COUNT)) count = NUMBER_WORDS[m[1]!] ?? Number(m[1])
  if (!count && /\b(mi pareja|mi novi[ao]|mi mujer|mi marido)\b/.test(text)) count = 2

  const fixture = fixtures.find((f) => f.id === fixtureId)
  const zone = ZONES.find((z) => z.id === zoneId)
  const total = fixture && zone && count ? fixture.prices[zone.id]! * count : undefined
  return { fixture, zone, count, total }
}
