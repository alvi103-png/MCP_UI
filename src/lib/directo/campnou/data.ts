// Datos de la web del Spotify Camp Nou: partidos, zonas y precios. Los partidos se
// calculan a partir de hoy para que la demo nunca enseñe fechas pasadas.

export type Competition = 'laliga' | 'ucl';

export const COMPETITIONS: Record<Competition, string> = {
	laliga: 'LaLiga EA Sports',
	ucl: 'UEFA Champions League',
};

export type Zone = {
	id: string;
	name: string;
	detail: string;
	price: number;
	membersOnly?: boolean;
};

export const ZONES: Zone[] = [
	{ id: 'tribuna', name: 'Tribuna', detail: 'Tribuna principal · cubierta', price: 140 },
	{ id: 'lateral', name: 'Lateral', detail: 'Frente a la Tribuna', price: 110 },
	{ id: 'gol-nord', name: 'Gol Nord', detail: 'Detrás de la portería norte', price: 75 },
	{ id: 'gol-sud', name: 'Gol Sud', detail: "Grada d'Animació · solo socios", price: 65, membersOnly: true },
	{ id: 'palco-vip', name: 'Palco VIP', detail: 'Hospitality · catering incluido', price: 450 },
];

// Escudos originales (Wikipedia). Sevilla y Liverpool van en WebP: sus SVG pesan casi 2 MB.
export const HOME_CREST = '/campnou/equipos/barcelona.svg';

type FixtureSeed = {
	id: string;
	rival: string;
	short: string;
	crest: string;
	competition: Competition;
	/** Días desde el primer sábado después de hoy. */
	offset: number;
	time: string;
	/** Multiplicador sobre el precio base de cada zona. */
	factor: number;
	tag?: string;
	maxTickets?: number;
	status: 'disponible' | 'ultimas';
};

const SEEDS: FixtureSeed[] = [
	{ id: 'sevilla', rival: 'Sevilla FC', short: 'SEV', crest: '/campnou/equipos/sevilla.webp', competition: 'laliga', offset: 0, time: '21:00', factor: 1, status: 'disponible' },
	{ id: 'manchester-city', rival: 'Manchester City', short: 'MCI', crest: '/campnou/equipos/manchester-city.svg', competition: 'ucl', offset: 10, time: '21:00', factor: 1.6, status: 'ultimas' },
	{ id: 'real-madrid', rival: 'Real Madrid', short: 'RMA', crest: '/campnou/equipos/real-madrid.svg', competition: 'laliga', offset: 15, time: '21:00', factor: 2.2, tag: 'El Clásico', maxTickets: 2, status: 'ultimas' },
	{ id: 'villarreal', rival: 'Villarreal CF', short: 'VIL', crest: '/campnou/equipos/villarreal.svg', competition: 'laliga', offset: 21, time: '18:30', factor: 1, status: 'disponible' },
	{ id: 'liverpool', rival: 'Liverpool FC', short: 'LIV', crest: '/campnou/equipos/liverpool.webp', competition: 'ucl', offset: 32, time: '21:00', factor: 1.6, status: 'disponible' },
	{ id: 'espanyol', rival: 'RCD Espanyol', short: 'ESP', crest: '/campnou/equipos/espanyol.svg', competition: 'laliga', offset: 36, time: '21:00', factor: 1.8, tag: 'Derbi barceloní', status: 'disponible' },
];

export const MAX_TICKETS = 6;

export type Fixture = FixtureSeed & {
	/** YYYY-MM-DD */
	date: string;
	/** "sáb 4 oct" */
	dateLabel: string;
	/** "sábado, 4 de octubre" */
	dateLong: string;
	prices: Record<string, number>;
};

const DAY = 24 * 60 * 60 * 1000;
const roundTo5 = (n: number) => Math.round(n / 5) * 5;

/** Hoy en España (Europe/Madrid), a mediodía UTC para poder sumar días sin líos de horario. */
export function spainToday(now = new Date()) {
	const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(Date.UTC(year!, month! - 1, day, 12));
}

export function buildFixtures(now = new Date()): Fixture[] {
	const today = spainToday(now);
	const toSaturday = (6 - today.getUTCDay() + 7) % 7 || 7;
	return SEEDS.map((seed) => {
		const day = new Date(today.getTime() + (toSaturday + seed.offset) * DAY);
		const short = day.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
		return {
			...seed,
			date: day.toISOString().slice(0, 10),
			dateLabel: short.replace(',', '').replace('.', ''),
			dateLong: day.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
			prices: Object.fromEntries(ZONES.map((zone) => [zone.id, roundTo5(zone.price * seed.factor)])),
		};
	});
}

export const formatEuros = (n: number) =>
	n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
