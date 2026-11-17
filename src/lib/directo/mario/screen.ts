// The screenshot Jev gets in the screen-only demo: the visible picture, nothing else.

import type { ActionId } from './actions.ts';
import { SCREEN_H, SCREEN_W } from './perception.ts';
import { GRID_TOP } from './ram.ts';

/** The moves Jev picks from when all it gets is the picture: run or jump. */
export const SCREEN_ACTIONS = ['run_right', 'run_jump_high'] as const satisfies readonly ActionId[];
export type ScreenAction = (typeof SCREEN_ACTIONS)[number];

/** jsnes draws an 8 px overscan border the TV never showed: the visible frame is 240x224. */
export const CROP = 8;
/**
 * The shot starts under the status bar (score, coins, world, time): the playfield's first tile
 * row. Jev has nothing to read up there, and the picture is 12 % smaller.
 */
export const SHOT_TOP = GRID_TOP;
/** TypeSafe takes images of 280 to 1568 px a side, so the frame is sent at 2x: 480x400. */
export const SHOT_SCALE = 2;
export const SHOT_W = (SCREEN_W - CROP * 2) * SHOT_SCALE;
export const SHOT_H = (SCREEN_H - CROP - SHOT_TOP) * SHOT_SCALE;

/** A box in the shot, as fractions of its width and height (what TypeSafe's Box questions answer). */
export interface ShotBox {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/** NES screen pixels to fractions of the shot, for a box at x, y of w by h pixels. */
export function toShotBox(x: number, y: number, w: number, h: number, top = SHOT_TOP): ShotBox {
	const width = SCREEN_W - CROP * 2;
	const height = SCREEN_H - CROP - top;
	return { left: (x - CROP) / width, right: (x + w - CROP) / width, top: (y - top) / height, bottom: (y + h - top) / height };
}

/**
 * Copies the visible frame out of a 256x240 jsnes buffer (0x..BBGGRR per pixel) as RGBA,
 * scaled with nearest neighbour so the pixel art stays sharp. Synchronous on purpose:
 * the shot is the exact frame of the request, whatever the encoder does afterwards.
 * `top`: the first NES row in the shot (CROP keeps the status bar).
 */
export function captureRgba(buffer: ArrayLike<number>, top = SHOT_TOP): Uint8ClampedArray<ArrayBuffer> {
	const height = (SCREEN_H - CROP - top) * SHOT_SCALE;
	const rgba = new Uint8ClampedArray(SHOT_W * height * 4);
	for (let y = 0; y < height; y++) {
		const row = (Math.floor(y / SHOT_SCALE) + top) * SCREEN_W + CROP;
		for (let x = 0; x < SHOT_W; x++) {
			const pixel = buffer[row + Math.floor(x / SHOT_SCALE)]!;
			const i = (y * SHOT_W + x) * 4;
			rgba[i] = pixel & 0xff;
			rgba[i + 1] = (pixel >> 8) & 0xff;
			rgba[i + 2] = (pixel >> 16) & 0xff;
			rgba[i + 3] = 0xff;
		}
	}
	return rgba;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array) {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** A PNG chunk: length, type, data and the CRC of type + data. */
function chunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/**
 * PNG with a palette (colour type 3). A NES frame uses at most 25 of the console's 64 colours,
 * so one byte per pixel keeps the picture exact and the file a few times smaller than the
 * RGBA PNG a canvas writes. PNG keeps the flat colours exact; JPEG would smear them.
 * Runs in the browser and in Node: both have CompressionStream.
 */
export async function encodePng(rgba: Uint8ClampedArray<ArrayBuffer>, width = SHOT_W): Promise<Blob> {
	const height = rgba.length / 4 / width;
	const palette = new Map<number, number>();
	// Each row: filter byte 0 (none), then one palette index per pixel.
	const rows = new Uint8Array(height * (width + 1));
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const rgb = (rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!;
			let index = palette.get(rgb);
			if (index === undefined) palette.set(rgb, (index = palette.size));
			rows[y * (width + 1) + 1 + x] = index;
		}
	}
	if (palette.size > 256) throw new Error(`A NES frame has at most 64 colours, got ${palette.size}`);
	const plte = new Uint8Array(palette.size * 3);
	for (const [rgb, index] of palette) plte.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff], index * 3);

	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	// 8-bit indices, colour type 3 (palette), deflate, adaptive filtering, no interlace.
	ihdr.set([8, 3, 0, 0, 0], 8);
	// PNG image data is a zlib stream: exactly what CompressionStream('deflate') writes.
	const idat = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

	return new Blob([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', idat), chunk('IEND', new Uint8Array())], {
		type: 'image/png',
	});
}
