// Turns raw RAM into what Jev "sees": Mario, enemies and terrain as numbers,
// plus screen-space geometry the UI uses to draw Jev's vision.

import {
	byte,
	digits,
	ENEMY_KINDS,
	ENEMY_SLOTS,
	GRID_ROWS,
	GRID_TOP,
	isSolid,
	NON_THREATS,
	PLAYER_DEAD,
	PLAYER_DYING,
	PLAYER_NORMAL,
	POWERUP_NAMES,
	POWERUP_OBJECT,
	POWERUP_SLOT,
	RAM,
	type Ram,
	readTile,
	signed,
	TILE,
	type TileKind,
	tileKind,
} from './ram.ts';

export type Phase = 'booting' | 'title' | 'playing' | 'dying' | 'flagpole' | 'transition' | 'gameover';

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface EnemyView {
	slot: number;
	kind: string;
	ahead: boolean;
	stompable: boolean;
	defeated: boolean;
	/** Horizontal gap in px between Mario's front and the enemy (negative = behind). */
	dx: number;
	/** Vertical offset in px of the enemy's top relative to Mario's feet level (positive = below). */
	dy: number;
	/** Enemy speed in px/frame (positive = right). */
	vx: number;
	box: Box;
}

export interface PowerupView {
	kind: string;
	dx: number;
	dy: number;
	box: Box;
}

export interface Column {
	/** Tiles ahead of Mario's column. */
	distance: number;
	/** Wall height in tiles (>0), 0 flat, negative drop, null bottomless pit. */
	surface: number | null;
	kind: TileKind | 'pit';
	column: number;
}

export interface Terrain {
	referenceRow: number;
	columns: Column[];
	wall: { distance: number; height: number; kind: string; column: number } | null;
	gap: { distance: number; width: number; farEdgeVisible: boolean; column: number } | null;
	overhead: { rows: number; kind: string } | null;
	flagpole: { distance: number; column: number } | null;
	visibleAhead: number;
}

export interface Landing {
	frames: number;
	distance: number;
	on: 'ground' | 'pit' | 'enemy';
	box: Box;
}

export interface Frame {
	phase: Phase;
	world: number;
	stage: number;
	area: number;
	x: number;
	y: number;
	screenLeft: number;
	vx: number;
	vy: number;
	grounded: boolean;
	size: 'small' | 'big';
	fire: boolean;
	column: number;
	feetRow: number;
	lives: number;
	time: number;
	score: number;
	coins: number;
	marioBox: Box;
	enemies: EnemyView[];
	powerup: PowerupView | null;
	terrain: Terrain;
	landing: Landing | null;
	deathCause: 'pit' | 'enemy' | 'time' | null;
}

export const SCREEN_W = 256;
export const SCREEN_H = 240;
const MAX_LOOKAHEAD = 10;

const rowAtScreenY = (screenY: number) => Math.floor((screenY - GRID_TOP) / TILE);

export function readPhase(ram: Ram): Phase {
	const mode = byte(ram, RAM.gameMode);
	const task = byte(ram, 0x0772);
	const sub = byte(ram, RAM.playerState);
	if (mode === 0xff) return 'booting';
	if (mode === 0) return 'title';
	if (mode === 3) return 'gameover';
	if (mode !== 1 || task !== 3) return 'transition';
	if (sub === PLAYER_DYING || sub === PLAYER_DEAD || byte(ram, RAM.playerYPage) > 1) return 'dying';
	if (byte(ram, RAM.floatState) === 3 || sub === 0x04 || sub === 0x05) return 'flagpole';
	if (sub === PLAYER_NORMAL) return 'playing';
	return 'transition';
}

export function readFrame(ram: Ram, groundedRow: number | null = null): Frame {
	const x = byte(ram, RAM.playerPage) * 256 + byte(ram, RAM.playerX);
	const y = byte(ram, RAM.playerY);
	const screenLeft = byte(ram, RAM.screenLeftPage) * 256 + byte(ram, RAM.screenLeftX);
	const power = byte(ram, RAM.powerup);
	const size = power > 0 ? 'big' : 'small';
	const grounded = byte(ram, RAM.floatState) === 0;
	const vx = signed(ram, RAM.playerVX) / 16;
	const vy = signed(ram, RAM.playerVY);
	const column = Math.floor((x + 8) / TILE);
	const screenY = y + 16;
	const feetRow = rowAtScreenY(screenY + 15);
	const marioBox: Box = {
		x: x - screenLeft,
		y: size === 'big' ? screenY - 16 : screenY,
		w: 16,
		h: size === 'big' ? 32 : 16,
	};

	const enemies: EnemyView[] = [];
	for (let slot = 0; slot < ENEMY_SLOTS; slot++) {
		if (!byte(ram, RAM.enemyActive + slot)) continue;
		const type = byte(ram, RAM.enemyType + slot);
		if (NON_THREATS.has(type)) continue;
		if (byte(ram, RAM.enemyYPage + slot) > 1) continue;
		const kind = ENEMY_KINDS[type] ?? { name: `enemy_0x${type.toString(16)}`, stompable: true };
		const ex = byte(ram, RAM.enemyPage + slot) * 256 + byte(ram, RAM.enemyX + slot);
		const ey = byte(ram, RAM.enemyY + slot) + 8;
		const state = byte(ram, RAM.enemyState + slot);
		const defeated = (state & 0x20) !== 0 || (kind.name === 'goomba' && state === 0x04);
		const dx = ex >= x ? ex - (x + 16) : ex + 16 - x;
		const vx = signed(ram, RAM.enemyVX + slot) / 16;
		// A kicked shell keeps the koopa's id but moves much faster than any walker.
		const shell = kind.name.endsWith('koopa') && Math.abs(vx) > 1.5;
		enemies.push({
			slot,
			kind: shell ? 'moving_shell' : kind.name,
			ahead: ex >= x,
			stompable: kind.stompable,
			defeated,
			dx: ex >= x ? Math.max(0, dx) : Math.min(0, dx),
			dy: ey + 15 - (screenY + 15),
			vx,
			box: { x: ex - screenLeft, y: ey, w: 16, h: 16 },
		});
	}

	let powerup: PowerupView | null = null;
	if (byte(ram, RAM.enemyActive + POWERUP_SLOT) && byte(ram, RAM.enemyType + POWERUP_SLOT) === POWERUP_OBJECT) {
		const px = byte(ram, RAM.enemyPage + POWERUP_SLOT) * 256 + byte(ram, RAM.enemyX + POWERUP_SLOT);
		const py = byte(ram, RAM.enemyY + POWERUP_SLOT) + 8;
		powerup = {
			kind: POWERUP_NAMES[byte(ram, RAM.powerupType)] ?? 'powerup',
			dx: px - x,
			dy: py - screenY,
			box: { x: px - screenLeft, y: py, w: 16, h: 16 },
		};
	}

	const referenceRow = grounded ? feetRow : (groundedRow ?? feetRow);
	const terrain = readTerrain(ram, column, referenceRow, feetRow, size, screenLeft);
	const landing = grounded ? null : predictLanding(ram, x, screenY, vx, vy, screenLeft, enemies);

	const phase = readPhase(ram);
	let deathCause: Frame['deathCause'] = null;
	if (phase === 'dying') {
		const time = digits(ram, RAM.time, 3);
		deathCause = byte(ram, RAM.playerYPage) > 1 ? 'pit' : time === 0 ? 'time' : 'enemy';
	}

	return {
		phase,
		world: byte(ram, RAM.world) + 1,
		stage: byte(ram, RAM.stage) + 1,
		area: byte(ram, RAM.area),
		x,
		y,
		screenLeft,
		vx,
		vy,
		grounded,
		size,
		fire: power === 2,
		column,
		feetRow,
		lives: byte(ram, RAM.lives) + 1,
		time: digits(ram, RAM.time, 3),
		score: digits(ram, RAM.score, 6),
		coins: digits(ram, RAM.coins, 2),
		marioBox,
		enemies,
		powerup,
		terrain,
		landing,
		deathCause,
	};
}

function readTerrain(
	ram: Ram,
	marioColumn: number,
	referenceRow: number,
	feetRow: number,
	size: 'small' | 'big',
	screenLeft: number,
): Terrain {
	const lastVisibleColumn = Math.floor((screenLeft + SCREEN_W - 1) / TILE);
	const visibleAhead = Math.max(0, Math.min(MAX_LOOKAHEAD, lastVisibleColumn - marioColumn));
	const kindAt = (column: number, row: number) => tileKind(readTile(ram, column, row));
	const solidAt = (column: number, row: number) => isSolid(kindAt(column, row));

	const columns: Column[] = [];
	for (let distance = 1; distance <= visibleAhead; distance++) {
		const column = marioColumn + distance;
		if (solidAt(column, referenceRow)) {
			let height = 0;
			while (referenceRow - height >= 0 && solidAt(column, referenceRow - height)) height++;
			columns.push({ distance, surface: height, kind: kindAt(column, referenceRow), column });
			continue;
		}
		let below = referenceRow + 1;
		while (below < GRID_ROWS && !solidAt(column, below)) below++;
		if (below >= GRID_ROWS) {
			columns.push({ distance, surface: null, kind: 'pit', column });
		} else {
			columns.push({ distance, surface: -(below - referenceRow - 1), kind: kindAt(column, below), column });
		}
	}

	const wallColumn = columns.find((column) => (column.surface ?? 0) > 0);
	const gapIndex = columns.findIndex((column) => column.surface === null);
	let gap: Terrain['gap'] = null;
	if (gapIndex >= 0) {
		let width = 0;
		while (gapIndex + width < columns.length && columns[gapIndex + width]!.surface === null) width++;
		const start = columns[gapIndex]!;
		gap = {
			distance: start.distance,
			width,
			farEdgeVisible: gapIndex + width < columns.length,
			column: start.column,
		};
	}

	let flagpole: Terrain['flagpole'] = null;
	for (const { distance, column } of columns) {
		let found = false;
		for (let row = 0; row < GRID_ROWS && !found; row++) found = kindAt(column, row) === 'flagpole';
		if (found) {
			flagpole = { distance, column };
			break;
		}
	}

	const headRow = size === 'big' ? feetRow - 1 : feetRow;
	let overhead: Terrain['overhead'] = null;
	for (let rows = 1; rows <= 4; rows++) {
		const kind = kindAt(marioColumn, headRow - rows);
		if (isSolid(kind)) {
			overhead = { rows, kind };
			break;
		}
	}

	return {
		referenceRow,
		columns,
		wall: wallColumn
			? { distance: wallColumn.distance, height: wallColumn.surface ?? 0, kind: wallColumn.kind, column: wallColumn.column }
			: null,
		gap,
		overhead,
		flagpole,
		visibleAhead,
	};
}

/** Simulates the rest of the current jump with SMB's measured gravity (~0.5 px/frame², 4 px/frame cap). */
function predictLanding(
	ram: Ram,
	x: number,
	screenY: number,
	vx: number,
	vy: number,
	screenLeft: number,
	enemies: EnemyView[],
): Landing | null {
	let px = x;
	let py = screenY;
	let velocity = vy;
	for (let frame = 1; frame <= 90; frame++) {
		velocity = Math.min(4, velocity + 0.5);
		px += vx;
		py += velocity;
		if (py + 16 >= SCREEN_H) {
			return { frames: frame, distance: Math.round((px - x) / TILE), on: 'pit', box: { x: px - screenLeft, y: SCREEN_H - 16, w: 16, h: 16 } };
		}
		if (velocity <= 0) continue;
		const feet = py + 16;
		const row = rowAtScreenY(feet);
		const left = Math.floor((px + 3) / TILE);
		const right = Math.floor((px + 12) / TILE);
		const solid = isSolid(tileKind(readTile(ram, left, row))) || isSolid(tileKind(readTile(ram, right, row)));
		const box = { x: px - screenLeft, y: GRID_TOP + row * TILE - 16, w: 16, h: 16 };
		const enemy = enemies.find((e) => {
			if (e.defeated) return false;
			const enemyX = e.box.x + e.vx * frame;
			return Math.abs(enemyX - (px - screenLeft)) < 14 && feet >= e.box.y && feet <= e.box.y + 10;
		});
		if (enemy) return { frames: frame, distance: Math.round((px - x) / TILE), on: 'enemy', box: { ...box, y: py } };
		if (solid && row >= 0) return { frames: frame, distance: Math.round((px - x) / TILE), on: 'ground', box };
	}
	return null;
}
