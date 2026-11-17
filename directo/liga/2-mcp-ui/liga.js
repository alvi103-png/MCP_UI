// Datos de LaLiga desde la API pública de ESPN (no necesita clave).
// No sabe nada de MCP: son funciones normales de JavaScript.
const ESPN = 'https://site.web.api.espn.com/apis';
const LALIGA = 'sports/soccer/esp.1';

const ZONAS = {
  'Champions League': 'Champions',
  'Europa League': 'Europa League',
  'Conference League qualifying': 'Conference League',
  Relegation: 'Descenso',
};

// Apodos que la gente usa y que ESPN no conoce
const APODOS = {
  barca: 'Barcelona',
  culers: 'Barcelona',
  madrid: 'Real Madrid',
  'el madrid': 'Real Madrid',
  atleti: 'Atlético de Madrid',
  atletico: 'Atlético de Madrid',
  athletic: 'Athletic Club',
  bilbao: 'Athletic Club',
  betis: 'Real Betis',
  'la real': 'Real Sociedad',
  depor: 'Deportivo La Coruña',
  periquitos: 'Espanyol',
  pericos: 'Espanyol',
};

const normalizar = (texto = '') =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

async function espn(ruta, parametros = {}) {
  const url = new URL(`${ESPN}/${ruta}`);
  url.search = new URLSearchParams({ lang: 'es', region: 'es', ...parametros });

  const respuesta = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!respuesta.ok) throw new Error(`La API de ESPN ha respondido con un ${respuesta.status}`);
  return respuesta.json();
}

/** Convierte un partido de ESPN en algo más manejable */
function partido(evento) {
  const { competitors, status, venue } = evento.competitions[0];
  const estado = status.type.state; // 'pre' (por jugar), 'in' (en juego) o 'post' (terminado)

  const equipo = (homeAway) => {
    const { team, score } = competitors.find((competidor) => competidor.homeAway === homeAway);
    return {
      id: team.id,
      nombre: team.displayName,
      escudo: team.logo ?? team.logos?.[0]?.href,
      goles: estado === 'pre' ? null : Number(score?.value ?? score),
    };
  };

  return {
    id: evento.id,
    fecha: evento.date,
    estado,
    estadio: venue?.fullName,
    local: equipo('home'),
    visitante: equipo('away'),
  };
}

const porFecha = (a, b) => a.fecha.localeCompare(b.fecha);

// 2026 → "2026/27"
const temporada = (año) => `${año}/${String(año + 1).slice(-2)}`;

export async function verClasificacion() {
  const { season, children } = await espn(`v2/${LALIGA}/standings`);

  const equipos = children[0].standings.entries.map(({ team, stats, note }) => {
    const dato = (nombre) => Number(stats.find((stat) => stat.name === nombre)?.value ?? 0);
    return {
      posicion: dato('rank'),
      id: team.id,
      nombre: team.displayName,
      nombreCorto: team.shortDisplayName,
      siglas: team.abbreviation,
      escudo: team.logos?.[0]?.href,
      puntos: dato('points'),
      jugados: dato('gamesPlayed'),
      ganados: dato('wins'),
      empatados: dato('ties'),
      perdidos: dato('losses'),
      golesAFavor: dato('pointsFor'),
      golesEnContra: dato('pointsAgainst'),
      zona: ZONAS[note?.description] ?? null,
    };
  });

  return {
    temporada: temporada(season.year),
    equipos: equipos.sort((a, b) => a.posicion - b.posicion),
  };
}

/** Partidos terminados (o en juego) de la última jornada */
export async function verResultados() {
  // Sin fecha, el marcador trae el calendario de la temporada: los días con partidos
  const { leagues } = await espn(`site/v2/${LALIGA}/scoreboard`);
  const { calendar, season } = leagues[0];
  const ahora = new Date();
  const dias = calendar.filter((dia) => new Date(dia) <= ahora).slice(-4);

  const marcadores = await Promise.all(
    dias.map((dia) => espn(`site/v2/${LALIGA}/scoreboard`, { dates: dia.slice(0, 10).replaceAll('-', '') })),
  );

  const partidos = marcadores
    .flatMap(({ events }) => events.map(partido))
    .filter((p) => p.estado !== 'pre')
    .sort(porFecha)
    .slice(-10);

  return { temporada: temporada(season.year), partidos };
}

/** Posición, últimos resultados y próximo partido de un equipo */
export async function verEquipo(texto) {
  const clasificacion = await verClasificacion();
  const { equipos } = clasificacion;
  const buscado = normalizar(APODOS[normalizar(texto)] ?? texto);

  const equipo =
    equipos.find((e) => [e.nombre, e.nombreCorto, e.siglas].some((nombre) => normalizar(nombre) === buscado)) ??
    equipos.find((e) => normalizar(e.nombre).includes(buscado));

  if (!equipo) {
    throw new Error(
      `No encuentro "${texto}" en LaLiga. Equipos: ${equipos.map((e) => e.nombre).join(', ')}.`,
    );
  }

  const [jugados, pendientes] = await Promise.all([
    espn(`site/v2/${LALIGA}/teams/${equipo.id}/schedule`),
    espn(`site/v2/${LALIGA}/teams/${equipo.id}/schedule`, { fixture: 'true' }),
  ]);

  const ultimos = jugados.events
    .map(partido)
    .filter((p) => p.estado === 'post')
    .sort(porFecha)
    .slice(-5)
    .reverse() // el más reciente primero
    .map((p) => ({ ...p, resultado: resultado(p, equipo.id) }));

  const proximo = pendientes.events.map(partido).filter((p) => p.estado !== 'post').sort(porFecha)[0] ?? null;

  return { ...equipo, temporada: clasificacion.temporada, ultimos, proximo };
}

/** 'G' (ganado), 'E' (empatado) o 'P' (perdido) desde el punto de vista del equipo */
function resultado(partido, idEquipo) {
  const [nuestros, suyos] =
    partido.local.id === idEquipo
      ? [partido.local.goles, partido.visitante.goles]
      : [partido.visitante.goles, partido.local.goles];
  return nuestros > suyos ? 'G' : nuestros < suyos ? 'P' : 'E';
}
