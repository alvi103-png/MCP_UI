// Counterfactual futures: replays each candidate macro on a cloned emulator,
// starting from the exact current frame, and reports what would happen.

import { NES } from 'jsnes';
import { ACTIONS, type ActionId, BUTTON, type Buttons, buttonsAt, programLength } from './actions.ts';
import { readFrame, readPhase } from './perception.ts';
import { byte, RAM, signed } from './ram.ts';

export type OutcomeResult =
	| 'safe'
	| 'stomps_enemy'
	| 'takes_damage'
	| 'dies'
	| 'dies_after_landing'
	| 'falls_in_pit'
	| 'blocked'
	| 'reaches_flagpole';

export interface Outcome {
	action: ActionId;
	result: OutcomeResult;
	frames: number;
	progressPx: number;
	/** Frames until an enemy at Mario's level touches him once the simulation ends (null = none close). */
	contactAfter: number | null;
	/** Mario's level-space position (x, screen y) for every simulated frame. */
	path: [number, number][];
}

export interface LookaheadRequest {
	snapshot: object;
	/** Buttons held on the real controller when the snapshot was taken. */
	held: Buttons;
	/** Buttons already committed before the candidate starts (real-time latency compensation). */
	prefix: Buttons[];
	candidates: ActionId[];
	window: number;
	/** Frames a non-jump choice stays in force (its macro is repeated for that long). */
	commit: number;
	/** Also return the picture after the prefix, for the screenshot-only demo. */
	screen?: boolean;
}

export interface LookaheadResult {
	outcomes: Outcome[];
	/** RAM after the prefix: the world as it will be when the decision takes effect. */
	ram: Uint8Array | null;
	/** The jsnes frame buffer after the prefix, when the request asked for it. */
	screen?: Uint32Array | null;
}

const FOLLOW_UP = BUTTON.RIGHT | BUTTON.B;
const LANDING_GRACE = 8;
const MAX_FRAMES = 120;

const NES_KEYS: [number, 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7][] = [
	[BUTTON.A, 0],
	[BUTTON.B, 1],
	[BUTTON.SELECT, 2],
	[BUTTON.START, 3],
	[BUTTON.UP, 4],
	[BUTTON.DOWN, 5],
	[BUTTON.LEFT, 6],
	[BUTTON.RIGHT, 7],
];

export class Lookahead {
	private nes: NES;
	private frameBuffer: Uint32Array | null = null;

	constructor(rom: Uint8Array) {
		this.nes = new NES({
			emulateSound: false,
			onFrame: (buffer: Uint32Array) => {
				this.frameBuffer = buffer;
			},
		});
		this.nes.loadROM(rom);
	}

	private get ram(): Uint8Array {
		return (this.nes as unknown as { cpu: { mem: Uint8Array } }).cpu.mem;
	}

	private held = 0;

	private step(buttons: Buttons) {
		for (const [bit, key] of NES_KEYS) {
			const want = (buttons & bit) !== 0;
			const had = (this.held & bit) !== 0;
			if (want && !had) this.nes.buttonDown(1, key);
			if (!want && had) this.nes.buttonUp(1, key);
		}
		this.held = buttons;
		this.nes.frame();
	}

	private restore(snapshot: object, held: Buttons) {
		// jsnes shares plain arrays (controller state, PPU buffers) by reference in
		// toJSON/fromJSON, so every run needs its own deep copy.
		this.nes.fromJSON(structuredClone(snapshot) as never);
		this.held = held;
	}

	run({ snapshot, held, prefix, candidates, window, commit, screen: wantScreen }: LookaheadRequest): LookaheadResult {
		let start = snapshot;
		let startHeld = held;
		let ram: Uint8Array | null = null;
		let screen: Uint32Array | null = null;
		// Play the committed prefix once, then branch every candidate from there.
		if (prefix.length) {
			this.restore(snapshot, held);
			for (const buttons of prefix) this.step(buttons);
			ram = this.ram.slice(0, 0x800);
			// jsnes reuses its buffer for the next frame: copy it.
			if (wantScreen && this.frameBuffer) screen = this.frameBuffer.slice();
			start = this.nes.toJSON();
			startHeld = this.held;
		}
		const outcomes = candidates.map((action) => {
			this.restore(start, startHeld);
			return this.simulate(action, window, commit);
		});
		return { outcomes, ram, screen };
	}

	private simulate(action: ActionId, window: number, commit: number): Outcome {
		const ram = this.ram;
		const x = () => byte(ram, RAM.playerPage) * 256 + byte(ram, RAM.playerX);
		const grounded = () => byte(ram, RAM.floatState) === 0;
		const startX = x();
		const startPower = byte(ram, RAM.powerup);
		const isJump = ACTIONS[action].jump;
		let program = ACTIONS[action].program(window);
		const first = program[0];
		if (first && first.buttons & BUTTON.A && this.held & BUTTON.A && grounded()) {
			program = [{ frames: 1, buttons: first.buttons & ~BUTTON.A }, ...program];
		}
		const length = programLength(program);
		// Jumps are followed by running right until shortly after landing.
		// Other macros are repeated for as long as the choice stays in force.
		const horizon = isJump ? MAX_FRAMES : Math.max(length, commit, 16);
		const path: [number, number][] = [];
		let stomped = false;
		let landedAt = -1;
		let wasAirborne = !grounded();
		let previousVy = signed(ram, RAM.playerVY);
		const end = (result: OutcomeResult, contactAfter: number | null = null): Outcome => ({
			action,
			result,
			frames: path.length,
			progressPx: x() - startX,
			contactAfter,
			path,
		});

		for (let frame = 0; frame < MAX_FRAMES; frame++) {
			const done = isJump ? landedAt >= 0 && frame - landedAt >= LANDING_GRACE && frame >= commit : frame >= horizon;
			// Never stop mid-air: a walk-off or short jump must play out to its landing.
			if (done && grounded()) break;
			const buttons = frame < length ? buttonsAt(program, frame) : isJump ? FOLLOW_UP : buttonsAt(program, frame % length);
			this.step(buttons);

			path.push([x(), byte(ram, RAM.playerY) + 16]);
			const phase = readPhase(ram);
			if (byte(ram, RAM.playerYPage) > 1) return end('falls_in_pit');
			if (phase === 'dying') return end(landedAt >= 0 && isJump ? 'dies_after_landing' : 'dies');
			if (phase === 'flagpole') return end('reaches_flagpole');
			if (byte(ram, RAM.powerup) < startPower || byte(ram, RAM.playerState) === 0x0a) return end('takes_damage');

			const vy = signed(ram, RAM.playerVY);
			// Only a stomp makes Mario bounce upward in mid-air.
			if (!grounded() && previousVy > 0 && vy < 0) stomped = true;
			previousVy = vy;
			if (!grounded()) wasAirborne = true;
			else if (wasAirborne && landedAt < 0) landedAt = frame;
		}

		// Still falling below ground level when time runs out: that is a pit.
		if (!grounded() && signed(ram, RAM.playerVY) > 0 && byte(ram, RAM.playerY) > 176) return end('falls_in_pit');
		const progress = x() - startX;
		const contact = contactAfter(ram);
		if (stomped) return end('stomps_enemy', contact);
		if (progress <= 2 && grounded() && action !== 'wait' && action !== 'jump_up' && action !== 'back_left') {
			return end('blocked', contact);
		}
		return end('safe', contact);
	}
}



function contactAfter(ram: Uint8Array): number | null {
	const frame = readFrame(ram);
	let best: number | null = null;
	for (const enemy of frame.enemies) {
		if (enemy.defeated || Math.abs(enemy.dy) > 16) continue;
		const closing = enemy.ahead ? frame.vx - enemy.vx : enemy.vx - frame.vx;
		const distance = Math.abs(enemy.dx);
		const frames = distance <= 1 ? 0 : closing > 0.1 ? Math.round(distance / closing) : null;
		if (frames !== null && frames <= 30 && (best === null || frames < best)) best = frames;
	}
	return best;
}
