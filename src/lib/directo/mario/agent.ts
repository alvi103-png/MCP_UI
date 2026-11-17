// Emulator + decision loop. Environment-agnostic: the browser drives it with
// requestAnimationFrame, the eval script drives it as fast as possible.

import { Controller, NES } from 'jsnes';
import { ACTION_IDS, ACTIONS, type ActionId, BUTTON, type Buttons, buttonsAt, type FocusId, programLength, type Segment } from './actions.ts';
import type { LookaheadRequest, LookaheadResult, Outcome } from './lookahead.ts';
import { type Frame, type Phase, readFrame, readPhase } from './perception.ts';
import type { Ram } from './ram.ts';
import type { ShotBox } from './screen.ts';
import { type JevState, Observer } from './state.ts';

export type Mode = 'sync' | 'realtime';

export interface Decision {
	action: ActionId;
	confidence: number;
	probabilities: Partial<Record<ActionId, number>>;
	focus: FocusId;
	jumpNow: number;
	danger: number;
	latencyMs: number;
	model?: string;
	requestId?: string;
	tokens?: number;
	/** Set when the shield replaced a fatal choice: the action Jev originally picked. */
	shieldedFrom?: ActionId;
	/** Screenshot demo: where Jev found Mario and the nearest hazard in the shot it was sent. */
	vision?: ScreenVision;
}

export interface ScreenVision {
	mario: ShotBox;
	/** null when Jev saw no hazard ahead at Mario's height. */
	hazard: ShotBox | null;
	kind: 'enemy' | 'wall' | 'pit' | null;
	/** NES pixels from Mario's front to the hazard, measured in code from the two boxes. */
	gapPx: number | null;
	/** The same gap even when Jev doubts the hazard is there (null: the box is not ahead of Mario). */
	measuredPx: number | null;
	/** Jev's probability that something is in Mario's way. */
	present: number;
}

/** `screen`: the predicted jsnes frame buffer, when the agent predicts the picture (`predictScreen`). */
export type Policy = (state: JevState, signal: AbortSignal, screen?: Uint32Array | null) => Promise<Decision>;

export type Simulate = (request: LookaheadRequest) => Promise<LookaheadResult>;

export interface DecisionRecord {
	id: number;
	frame: number;
	state: JevState;
	decision: Decision;
	delayFrames: number;
}

export type AgentEvent =
	| { type: 'request'; id: number; state: JevState }
	| { type: 'decision'; record: DecisionRecord }
	| { type: 'error'; message: string }
	| { type: 'death'; cause: Frame['deathCause']; x: number; level: string }
	| { type: 'clear'; level: string }
	| { type: 'level'; level: string }
	| { type: 'gameover' };

const NES_BUTTONS: [number, number][] = [
	[BUTTON.A, Controller.BUTTON_A],
	[BUTTON.B, Controller.BUTTON_B],
	[BUTTON.SELECT, Controller.BUTTON_SELECT],
	[BUTTON.START, Controller.BUTTON_START],
	[BUTTON.UP, Controller.BUTTON_UP],
	[BUTTON.DOWN, Controller.BUTTON_DOWN],
	[BUTTON.LEFT, Controller.BUTTON_LEFT],
	[BUTTON.RIGHT, Controller.BUTTON_RIGHT],
];

const FATAL = new Set(['dies', 'dies_after_landing', 'falls_in_pit', 'takes_damage']);

/** fatal: the future ends badly. high: it ends trapped or blocked. low: safe with room to react. */
export const riskOf = (outcome: Outcome): 'fatal' | 'high' | 'low' => {
	if (FATAL.has(outcome.result)) return 'fatal';
	if (outcome.result === 'blocked' || (outcome.contactAfter !== null && outcome.contactAfter < 10)) return 'high';
	return 'low';
};

/** Keeps Jev's own preferences but never executes a future the simulator saw ending in death. */
function shielded(decision: Decision, outcomes: Outcome[]): Decision {
	const risk = new Map(outcomes.map((outcome) => [outcome.action, riskOf(outcome)]));
	if (risk.get(decision.action) !== 'fatal') return decision;
	const alternatives = outcomes.filter((outcome) => risk.get(outcome.action) !== 'fatal');
	if (!alternatives.length) return decision;
	const best = alternatives.reduce((a, b) =>
		(decision.probabilities[b.action] ?? 0) > (decision.probabilities[a.action] ?? 0) ? b : a,
	);
	return { ...decision, action: best.action, shieldedFrom: decision.action };
}

export class Emulator {
	readonly nes: NES;
	frames = 0;
	buttons: Buttons = 0;
	private rom: Uint8Array;

	constructor(rom: Uint8Array, onFrame?: (buffer: Uint32Array) => void) {
		this.rom = rom;
		this.nes = new NES({ emulateSound: false, onFrame: onFrame ?? (() => {}) });
		this.nes.loadROM(rom);
	}

	get ram(): Ram {
		return (this.nes as unknown as { cpu: { mem: Uint8Array } }).cpu.mem;
	}

	step(buttons: Buttons) {
		for (const [bit, key] of NES_BUTTONS) {
			const want = (buttons & bit) !== 0;
			const had = (this.buttons & bit) !== 0;
			if (want && !had) this.nes.buttonDown(1, key as 0);
			if (!want && had) this.nes.buttonUp(1, key as 0);
		}
		this.buttons = buttons;
		this.nes.frame();
		this.frames++;
	}

	reset() {
		this.step(0);
		this.nes.loadROM(this.rom);
		this.frames = 0;
	}
}

interface RunningMacro {
	action: ActionId;
	program: Segment[];
	length: number;
	cursor: number;
}

export interface AgentOptions {
	mode?: Mode;
	window?: number;
	simulate?: Simulate;
}

export class MarioAgent {
	mode: Mode;
	window: number;
	running = false;
	frame: Frame | null = null;
	phase: Phase = 'booting';
	macro: RunningMacro | null = null;
	pending: { id: number; frame: number; startedAt: number; controller: AbortController; applyAt: number | null } | null =
		null;
	/** Whether candidate actions are simulated before asking Jev. */
	lookahead = true;
	/** Replace a choice the simulation marks as fatal with Jev's most likely non-fatal one. */
	shield = true;
	/**
	 * Ask Jev while Mario is airborne. Without moves that steer in the air, a mid-air jump only
	 * holds A through the landing, and SMB needs A released to jump again: Mario lands unable to
	 * jump over the next enemy. Off, the agent keeps running and asks again on the ground.
	 */
	decideInAir = true;
	/**
	 * Real time without futures: still play the committed buttons on a cloned emulator and hand the
	 * policy the picture of the frame where its answer will land. Needs `simulate`.
	 */
	predictScreen = false;
	outcomes: Outcome[] = [];
	lastRecord: DecisionRecord | null = null;
	lastState: JevState | null = null;
	stats = { decisions: 0, deaths: 0, clears: 0, latencies: [] as number[], tokens: 0, errors: 0 };

	private observer = new Observer();
	private ready: { decision: Decision; id: number; window: number; applyAt: number } | null = null;
	private simulate: Simulate | undefined;
	private nextId = 1;
	private stepping = false;
	private stepMacro: RunningMacro | null = null;
	private listeners = new Set<(event: AgentEvent) => void>();
	private lastLevel = '';
	private carry: Buttons = 0;

	readonly emulator: Emulator;
	private policy: Policy;

	constructor(emulator: Emulator, policy: Policy, options: AgentOptions = {}) {
		this.emulator = emulator;
		this.policy = policy;
		this.simulate = options.simulate;
		this.mode = options.mode ?? 'sync';
		this.window = options.window ?? 8;
	}

	on(listener: (event: AgentEvent) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: AgentEvent) {
		for (const listener of this.listeners) listener(event);
	}

	get bestX() {
		return this.observer.best;
	}

	get thinking() {
		return this.pending !== null;
	}

	play() {
		this.running = true;
		this.stepping = false;
	}

	pause() {
		this.running = false;
		this.stepping = false;
	}

	/** Runs until the next decision has been fully executed, then pauses. */
	stepOnce() {
		this.running = true;
		this.stepping = true;
		this.stepMacro = null;
	}

	restart() {
		this.cancelPending();
		this.ready = null;
		this.macro = null;
		this.carry = 0;
		this.observer.reset();
		this.lastRecord = null;
		this.lastState = null;
		this.lastLevel = '';
		this.phase = 'booting';
		this.emulator.reset();
	}

	private cancelPending() {
		this.pending?.controller.abort();
		this.pending = null;
	}

	/** Advances at most one emulator frame. */
	tick(): 'advanced' | 'waiting' | 'paused' {
		if (!this.running) return 'paused';
		const ram = this.emulator.ram;
		const phase = readPhase(ram);
		const previousPhase = this.phase;
		this.phase = phase;

		if (phase !== 'playing') {
			this.onNonPlaying(phase, previousPhase);
			return 'advanced';
		}

		const frame = readFrame(ram, this.observer.groundedRow);
		this.frame = frame;
		if (previousPhase !== 'playing') this.onLevelStart(frame);
		this.observer.track(frame);

		if (this.macro && this.macro.cursor < this.macro.length) {
			this.runMacroFrame();
			return 'advanced';
		}

		// Step mode stops right after the macro it started has finished.
		if (this.stepping && this.stepMacro && this.macro === this.stepMacro) {
			this.stepMacro = null;
			this.pause();
			return 'paused';
		}

		// In real time a decision lands exactly on the frame its futures were simulated for.
		if (this.ready && this.emulator.frames >= this.ready.applyAt) {
			this.startMacro(this.ready.decision.action, frame, this.ready.window);
			this.ready = null;
			this.runMacroFrame();
			return 'advanced';
		}

		if (!this.decideInAir && !frame.grounded && !this.pending && !this.ready) {
			this.emulator.step(this.carry);
			return 'advanced';
		}
		if (!this.pending && !this.ready) this.request(frame);
		if (this.mode === 'sync') return 'waiting';
		// Real time with futures: never let the world run past the frame Jev's futures were simulated for.
		if (this.pending?.applyAt != null && this.emulator.frames >= this.pending.applyAt) return 'waiting';
		this.emulator.step(this.carry);
		return 'advanced';
	}

	private onNonPlaying(phase: Phase, previousPhase: Phase) {
		if (phase !== previousPhase) {
			this.cancelPending();
			this.ready = null;
			this.macro = null;
			const level = this.frame ? `${this.frame.world}-${this.frame.stage}` : '';
			if (phase === 'dying' && previousPhase === 'playing') {
				const frame = readFrame(this.emulator.ram);
				this.stats.deaths++;
				this.emit({ type: 'death', cause: frame.deathCause, x: frame.x, level });
			}
			if (phase === 'flagpole' && previousPhase === 'playing') {
				this.stats.clears++;
				this.emit({ type: 'clear', level });
			}
			if (phase === 'gameover') this.emit({ type: 'gameover' });
		}
		// Title and game-over screens need START to continue.
		const pressStart = (phase === 'title' || phase === 'gameover' || phase === 'booting') && this.emulator.frames % 40 < 2;
		this.emulator.step(pressStart ? BUTTON.START : 0);
	}

	private onLevelStart(frame: Frame) {
		this.observer.reset();
		const level = `${frame.world}-${frame.stage}`;
		if (level !== this.lastLevel) {
			this.lastLevel = level;
			this.emit({ type: 'level', level });
		}
	}

	private startMacro(action: ActionId, frame: Frame, window: number) {
		const spec = ACTIONS[action];
		let program = spec.program(window);
		const first = program[0];
		// A new jump needs A released for one frame if it was still held.
		if (first && first.buttons & BUTTON.A && this.emulator.buttons & BUTTON.A && frame.grounded) {
			program = [{ frames: 1, buttons: first.buttons & ~BUTTON.A }, ...program];
		}
		this.macro = { action, program, length: programLength(program), cursor: 0 };
		if (this.stepping) this.stepMacro = this.macro;
		// In real-time mode, keep the direction of the last macro while waiting for Jev.
		const last = program.at(-1)?.buttons ?? 0;
		this.carry = last & ~BUTTON.A;
	}

	private runMacroFrame() {
		const macro = this.macro!;
		const buttons = buttonsAt(macro.program, macro.cursor);
		macro.cursor++;
		this.emulator.step(buttons);
		// Real-time mode asks for the next decision as soon as this macro is committed,
		// unless the macro is a jump whose answer would land mid-air.
		const airborneAnswer = !this.decideInAir && ACTIONS[macro.action].jump;
		if (this.mode === 'realtime' && macro.cursor === 1 && !this.pending && this.frame && !airborneAnswer) this.request(this.frame);
	}

	/** Something within reach that deserves shorter windows and simulated futures. */
	private busy(frame: Frame) {
		const { wall, gap } = frame.terrain;
		return (
			!frame.grounded ||
			(wall !== null && wall.distance <= 5) ||
			(gap !== null && gap.distance <= 6) ||
			frame.enemies.some((enemy) => !enemy.defeated && enemy.dx > -48 && enemy.dx < 176 && Math.abs(enemy.dy) < 80) ||
			frame.powerup !== null
		);
	}

	private request(current: Frame) {
		const id = this.nextId++;
		const busy = this.busy(current);
		const realtime = this.mode === 'realtime';
		// Clear paths get longer windows in turn mode; real time always predicts ahead, so it keeps the base window.
		const window = busy || realtime ? this.window : this.window * 2;
		const delay = realtime ? this.averageDelayFrames() : 0;
		const controller = new AbortController();
		const requestFrame = this.emulator.frames;
		const groundedRow = this.observer.groundedRow;
		this.outcomes = [];

		const futures = this.lookahead && (busy || realtime);
		const lookahead: LookaheadRequest | null =
			this.simulate && (futures || (this.predictScreen && realtime))
				? {
						snapshot: this.emulator.nes.toJSON(),
						held: this.emulator.buttons,
						prefix: realtime ? this.committedButtons(delay) : [],
						candidates: futures ? [...ACTION_IDS] : [],
						screen: this.predictScreen,
						window,
						// How long a choice stays in force before the next one can land.
						commit: realtime ? Math.max(window * 2, delay + window) : window * 2,
					}
				: null;

		const applyAt = requestFrame + (lookahead?.prefix.length ?? 0);
		this.pending = {
			id,
			frame: requestFrame,
			startedAt: performance.now(),
			controller,
			applyAt: realtime && lookahead ? applyAt : null,
		};

		const run = async () => {
			let frame = current;
			let outcomes: Outcome[] = [];
			let screen: Uint32Array | null = null;
			if (lookahead && this.simulate) {
				const result = await this.simulate(lookahead);
				if (this.pending?.id !== id) throw new DOMException('stale', 'AbortError');
				// In real time, Jev sees the world as it will be when its answer lands.
				if (result.ram) frame = readFrame(result.ram, groundedRow);
				outcomes = result.outcomes;
				screen = result.screen ?? null;
			}
			const state = this.observer.build(frame, {
				window,
				delayFrames: lookahead?.prefix.length ? 0 : delay,
				lastAction: this.lastRecord?.decision.action ?? null,
			});
			if (outcomes.length && (busy || realtime || !frame.grounded)) {
				state.simulated_outcomes = Object.fromEntries(
					outcomes.map((outcome) => [
						outcome.action,
						{
							risk: riskOf(outcome),
							result: outcome.result,
							frames: outcome.frames,
							progress_px: outcome.progressPx,
							enemy_contact_after_frames: outcome.contactAfter,
						},
					]),
				);
			}
			this.outcomes = outcomes;
			this.lastState = state;
			this.emit({ type: 'request', id, state });
			const decision = await this.policy(state, controller.signal, screen);
			return { decision: this.shield ? shielded(decision, outcomes) : decision, state };
		};

		run().then(
			({ decision, state }) => {
				if (this.pending?.id !== id) return;
				this.pending = null;
				const record: DecisionRecord = {
					id,
					frame: requestFrame,
					state,
					decision,
					delayFrames: this.emulator.frames - requestFrame,
				};
				this.lastRecord = record;
				this.stats.decisions++;
				this.stats.latencies.push(decision.latencyMs);
				if (this.stats.latencies.length > 200) this.stats.latencies.shift();
				this.stats.tokens += decision.tokens ?? 0;
				this.ready = { decision, id, window, applyAt: realtime ? applyAt : 0 };
				if (realtime) {
					this.delays.push(record.delayFrames);
					if (this.delays.length > 20) this.delays.shift();
				}
				this.emit({ type: 'decision', record });
			},
			(error: unknown) => {
				if (this.pending?.id !== id) return;
				this.pending = null;
				if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
				this.stats.errors++;
				this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			},
		);
	}

	/** Buttons the real controller will press before a new decision can take effect. */
	private committedButtons(delay: number): Buttons[] {
		const buttons: Buttons[] = [];
		const macro = this.macro;
		if (macro) for (let frame = macro.cursor; frame < macro.length; frame++) buttons.push(buttonsAt(macro.program, frame));
		while (buttons.length < delay) buttons.push(this.carry);
		return buttons;
	}

	private delays: number[] = [];

	/** Frames Jev usually needs to answer (simulation + network + model), with a safety margin. */
	private averageDelayFrames() {
		const recent = [...this.delays.slice(-12)].sort((a, b) => a - b);
		if (recent.length < 3) return 30;
		return recent[Math.floor(recent.length * 0.75)]! + 3;
	}

	/** Resolves when the in-flight Jev request settles. */
	async settle() {
		while (this.pending) await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
