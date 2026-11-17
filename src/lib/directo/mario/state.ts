// Stateful observer: keeps episode memory between decisions and builds the
// compact JSON Jev receives. Timing arithmetic lives here; the choice stays with Jev.

import type { ActionId } from './actions.ts';
import type { EnemyView, Frame } from './perception.ts';
import { TILE } from './ram.ts';

export interface JevState {
	objective: string;
	level: string;
	mario: {
		size: 'small' | 'big';
		grounded: boolean;
		jump_phase: 'grounded' | 'rising' | 'falling';
		speed_x: number;
		speed_y: number;
		max_run_speed_x: number;
		frames_in_air: number;
	};
	terrain: {
		measured_from: 'feet' | 'last_ground_level';
		profile_ahead: (number | null)[];
		profile_legend: string;
		wall: { distance_tiles: number; distance_px: number; height_tiles: number; kind: string } | null;
		gap: { distance_tiles: number; distance_px: number; width_tiles: number; far_edge_visible: boolean } | null;
		block_overhead: { tiles_above: number; kind: string } | null;
		flagpole_distance_tiles: number | null;
		tiles_visible_ahead: number;
	};
	enemies: {
		kind: string;
		position: 'ahead' | 'behind';
		distance_px: number;
		height_offset_px: number;
		level: 'same' | 'above' | 'below';
		speed_x: number;
		closing_speed: number;
		frames_to_contact: number | null;
		stompable: boolean;
	}[];
	powerup: { kind: string; distance_px: number; height_offset_px: number } | null;
	landing: { frames: number; distance_tiles: number; on: 'ground' | 'pit' | 'enemy' } | null;
	simulated_outcomes?: Partial<
		Record<
			ActionId,
			{ risk: string; result: string; frames: number; progress_px: number; enemy_contact_after_frames: number | null }
		>
	>;
	timing: {
		decision_window_frames: number;
		inference_delay_frames: number;
		reaction_horizon_frames: number;
		jump_must_start_now: boolean;
		reasons: string[];
	};
	last_action: {
		action: ActionId | null;
		result: string;
		progress_px: number;
	};
	episode: {
		lives: number;
		time_left: number;
		progress_px: number;
		best_progress_px: number;
		stalled_decisions: number;
	};
}

export interface DecisionContext {
	window: number;
	delayFrames: number;
	lastAction: ActionId | null;
}

const MAX_RUN_SPEED = 2.5;
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export class Observer {
	groundedRow: number | null = null;
	private airborneFrames = 0;
	private bestX = 0;
	private stalled = 0;
	private lastDecision: { x: number; size: Frame['size']; score: number; defeated: number } | null = null;
	private wasAirborneSinceDecision = false;

	reset() {
		this.groundedRow = null;
		this.airborneFrames = 0;
		this.stalled = 0;
		this.lastDecision = null;
		this.wasAirborneSinceDecision = false;
	}

	/** Call once per emulated frame while Mario is controllable. */
	track(frame: Frame) {
		if (frame.grounded) {
			this.groundedRow = frame.feetRow;
			this.airborneFrames = 0;
		} else {
			this.airborneFrames++;
			this.wasAirborneSinceDecision = true;
		}
		this.bestX = Math.max(this.bestX, frame.x);
	}

	get best() {
		return this.bestX;
	}

	build(frame: Frame, context: DecisionContext): JevState {
		const horizon = context.window + context.delayFrames;
		const speed = Math.max(Math.abs(frame.vx), 1.5);
		const travel = speed * horizon;
		const front = frame.x + 16;
		const terrain = frame.terrain;
		const reasons: string[] = [];

		const wall = terrain.wall
			? {
					distance_tiles: terrain.wall.distance,
					distance_px: Math.max(0, terrain.wall.column * TILE - front),
					height_tiles: terrain.wall.height,
					kind: terrain.wall.kind,
				}
			: null;
		const gap = terrain.gap
			? {
					distance_tiles: terrain.gap.distance,
					distance_px: Math.max(0, terrain.gap.column * TILE - front),
					width_tiles: terrain.gap.width,
					far_edge_visible: terrain.gap.farEdgeVisible,
				}
			: null;

		if (frame.grounded) {
			if (wall && wall.distance_px <= travel + 8) reasons.push(`wall ${wall.height_tiles} tiles high reached before next decision`);
			if (gap && gap.distance_px <= travel + 4) reasons.push('gap edge reached before next decision');
		}

		const enemies = frame.enemies
			.filter((enemy) => !enemy.defeated)
			.map((enemy) => describeEnemy(enemy, frame.vx))
			.sort((a, b) => Math.abs(a.distance_px) - Math.abs(b.distance_px));
		const threat = enemies.find(
			(enemy) => enemy.position === 'ahead' && enemy.level === 'same' && enemy.frames_to_contact !== null,
		);
		if (frame.grounded && threat?.frames_to_contact != null && threat.frames_to_contact <= horizon + 10) {
			reasons.push(`${threat.kind} contact in ${threat.frames_to_contact} frames`);
		}
		const chaser = enemies.find(
			(enemy) => enemy.position === 'behind' && enemy.level === 'same' && (enemy.frames_to_contact ?? 99) <= horizon,
		);
		if (frame.grounded && chaser) reasons.push(`${chaser.kind} catching up from behind`);

		const previous = this.lastDecision;
		const progress = previous ? frame.x - previous.x : 0;
		if (previous && frame.grounded) {
			this.stalled = progress <= 2 && context.lastAction !== 'wait' ? this.stalled + 1 : 0;
		}
		let result = 'first_decision';
		if (previous) {
			const defeated = frame.enemies.filter((enemy) => enemy.defeated).length;
			if (frame.size === 'small' && previous.size === 'big') result = 'took_damage';
			else if (defeated > previous.defeated || frame.score - previous.score >= 100) result = 'defeated_enemy_or_scored';
			else if (!frame.grounded) result = 'in_air';
			else if (this.wasAirborneSinceDecision) result = 'landed';
			else if (progress > 2) result = 'advanced';
			else result = this.stalled >= 2 ? 'blocked' : 'no_progress';
		}
		this.lastDecision = {
			x: frame.x,
			size: frame.size,
			score: frame.score,
			defeated: frame.enemies.filter((enemy) => enemy.defeated).length,
		};
		this.wasAirborneSinceDecision = false;

		return {
			objective: 'Reach the flagpole at the end of the level without dying. Progress means moving right.',
			level: `${frame.world}-${frame.stage}`,
			mario: {
				size: frame.size,
				grounded: frame.grounded,
				jump_phase: frame.grounded ? 'grounded' : frame.vy < 0 ? 'rising' : 'falling',
				speed_x: round(frame.vx),
				speed_y: frame.vy,
				max_run_speed_x: MAX_RUN_SPEED,
				frames_in_air: this.airborneFrames,
			},
			terrain: {
				measured_from: frame.grounded ? 'feet' : 'last_ground_level',
				profile_ahead: terrain.columns.map((column) => column.surface),
				profile_legend: 'One entry per tile ahead: positive = wall height in tiles, 0 = flat, negative = step down, null = bottomless pit.',
				wall,
				gap,
				block_overhead: terrain.overhead ? { tiles_above: terrain.overhead.rows, kind: terrain.overhead.kind } : null,
				flagpole_distance_tiles: terrain.flagpole?.distance ?? null,
				tiles_visible_ahead: terrain.visibleAhead,
			},
			enemies: enemies.slice(0, 4),
			powerup: frame.powerup
				? { kind: frame.powerup.kind, distance_px: frame.powerup.dx, height_offset_px: frame.powerup.dy }
				: null,
			landing: frame.landing
				? { frames: frame.landing.frames, distance_tiles: frame.landing.distance, on: frame.landing.on }
				: null,
			timing: {
				decision_window_frames: context.window,
				inference_delay_frames: context.delayFrames,
				reaction_horizon_frames: horizon,
				jump_must_start_now: reasons.length > 0,
				reasons,
			},
			last_action: {
				action: context.lastAction,
				result,
				progress_px: progress,
			},
			episode: {
				lives: frame.lives,
				time_left: frame.time,
				progress_px: frame.x,
				best_progress_px: this.bestX,
				stalled_decisions: this.stalled,
			},
		};
	}
}

function describeEnemy(enemy: EnemyView, marioVx: number): JevState['enemies'][number] {
	const level = enemy.dy < -20 ? 'above' : enemy.dy > 20 ? 'below' : 'same';
	const closing = enemy.ahead ? marioVx - enemy.vx : enemy.vx - marioVx;
	const distance = Math.abs(enemy.dx);
	return {
		kind: enemy.kind,
		position: enemy.ahead ? 'ahead' : 'behind',
		distance_px: distance,
		height_offset_px: enemy.dy,
		level,
		speed_x: round(enemy.vx),
		closing_speed: round(closing),
		frames_to_contact: closing > 0.1 ? Math.round(distance / closing) : distance === 0 ? 0 : null,
		stompable: enemy.stompable,
	};
}
