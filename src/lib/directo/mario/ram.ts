// Super Mario Bros. (NES) RAM map. Verified against the ROM running in jsnes.
// Positions use level coordinates (page * 256 + x). Speeds are signed bytes.

export const RAM = {
	gameMode: 0x0770, // 0 title/demo, 1 playing, 2 world end, 3 game over
	playerState: 0x000e, // 8 normal, 0x0b dying, 0x06 dead
	floatState: 0x001d, // 0 grounded, 1 jumping, 2 falling, 3 flagpole
	playerPage: 0x006d,
	playerX: 0x0086,
	playerY: 0x00ce,
	playerYPage: 0x00b5, // > 1 means Mario fell below the screen
	playerVX: 0x0057, // 1/16 px per frame
	playerVY: 0x009f, // px per frame, negative is up
	powerup: 0x0756, // 0 small, 1 big, 2 fire
	lives: 0x075a,
	world: 0x075f,
	stage: 0x075c,
	area: 0x0760,
	screenLeftPage: 0x071a,
	screenLeftX: 0x071c,
	time: 0x07f8, // 3 decimal digits
	score: 0x07dd, // 6 decimal digits
	coins: 0x07ed, // 2 decimal digits
	enemyActive: 0x000f,
	enemyType: 0x0016,
	enemyState: 0x001e,
	enemyPage: 0x006e,
	enemyX: 0x0087,
	enemyY: 0x00cf,
	enemyYPage: 0x00b6,
	enemyVX: 0x0058, // 1/16 px per frame
	powerupType: 0x0039, // 0 mushroom, 1 flower, 2 star, 3 1-up
	tiles: 0x0500, // 2 pages x 13 rows x 16 columns of metatiles
} as const;

export const PLAYER_NORMAL = 0x08;
export const PLAYER_DYING = 0x0b;
export const PLAYER_DEAD = 0x06;
export const ENEMY_SLOTS = 5;
export const POWERUP_SLOT = 5;
export const POWERUP_OBJECT = 0x2e;

export type Ram = Uint8Array;

export const byte = (ram: Ram, address: number) => ram[address] ?? 0;

export const signed = (ram: Ram, address: number) => (byte(ram, address) << 24) >> 24;

export const digits = (ram: Ram, address: number, count: number) => {
	let value = 0;
	for (let i = 0; i < count; i++) value = value * 10 + byte(ram, address + i);
	return value;
};

export interface EnemyKind {
	name: string;
	stompable: boolean;
}

const enemy = (name: string, stompable = true): EnemyKind => ({ name, stompable });

export const ENEMY_KINDS: Record<number, EnemyKind> = {
	0x00: enemy('green_koopa'),
	0x01: enemy('red_koopa'),
	0x02: enemy('buzzy_beetle'),
	0x03: enemy('red_koopa'),
	0x04: enemy('green_koopa'),
	0x05: enemy('hammer_bro'),
	0x06: enemy('goomba'),
	0x07: enemy('blooper', false),
	0x08: enemy('bullet_bill'),
	0x09: enemy('yellow_paratroopa'),
	0x0a: enemy('cheep_cheep', false),
	0x0b: enemy('cheep_cheep', false),
	0x0c: enemy('podoboo', false),
	0x0d: enemy('piranha_plant', false),
	0x0e: enemy('green_paratroopa'),
	0x0f: enemy('red_paratroopa'),
	0x10: enemy('green_paratroopa'),
	0x11: enemy('lakitu'),
	0x12: enemy('spiny', false),
	0x14: enemy('flying_cheep_cheep'),
	0x15: enemy('bowser_fire', false),
	0x16: enemy('fireworks', false),
	0x1b: enemy('firebar', false),
	0x1c: enemy('firebar', false),
	0x1d: enemy('firebar', false),
	0x1e: enemy('firebar', false),
	0x1f: enemy('firebar', false),
	0x2d: enemy('bowser', false),
};

// Objects that share enemy slots but are not threats.
export const NON_THREATS = new Set([0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2e, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35]);

export const POWERUP_NAMES = ['mushroom', 'fire_flower', 'star', 'one_up'] as const;

// Metatiles Mario can pass through: coins, flagpole, vines and hidden blocks.
const PASSABLE_TILES = new Set([0x00, 0x24, 0x25, 0x26, 0x5f, 0x60, 0x86, 0x87, 0xc2, 0xc3]);
const FLAGPOLE_TILES = new Set([0x24, 0x25]);
const PIPE_TILES = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21]);
const QUESTION_TILES = new Set([0xc0, 0xc1]);
const BRICK_TILES = new Set([0x51, 0x52]);

export type TileKind = 'empty' | 'solid' | 'pipe' | 'brick' | 'question' | 'coin' | 'flagpole';

export const tileKind = (id: number): TileKind => {
	if (FLAGPOLE_TILES.has(id)) return 'flagpole';
	if (id === 0xc2 || id === 0xc3) return 'coin';
	if (PASSABLE_TILES.has(id)) return 'empty';
	if (PIPE_TILES.has(id)) return 'pipe';
	if (QUESTION_TILES.has(id)) return 'question';
	if (BRICK_TILES.has(id)) return 'brick';
	return 'solid';
};

export const isSolid = (kind: TileKind) => kind !== 'empty' && kind !== 'coin' && kind !== 'flagpole';

export const TILE = 16;
export const GRID_ROWS = 13;
export const GRID_TOP = 32; // First metatile row starts under the status bar

/** Metatile row for a level-space y coordinate (Mario's y points at his lower 16 px half). */
export const rowOfY = (y: number) => Math.floor((y - 16) / TILE);

/** Screen y (in NES pixels) of the top of a metatile row. */
export const rowTop = (row: number) => GRID_TOP + row * TILE;

export const readTile = (ram: Ram, column: number, row: number): number => {
	if (row < 0 || row >= GRID_ROWS) return 0;
	const wrapped = ((column % 32) + 32) % 32;
	const page = wrapped >= 16 ? 1 : 0;
	return byte(ram, RAM.tiles + page * GRID_ROWS * 16 + row * 16 + (wrapped % 16));
};
