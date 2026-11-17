// Server-side only: asks Jev (TypeSafe System One) for the next Mario decision.

import { choice, noul, score, type TypeSafeClient, type Usage } from '@typesafe-ai/sdk';
import { ACTION_IDS, ACTIONS, type ActionId, FOCUS, FOCUS_IDS, type FocusId } from '../mario/actions.ts';
import type { Decision } from '../mario/agent.ts';
import type { JevState } from '../mario/state.ts';

const actionCriteria = Object.fromEntries(ACTION_IDS.map((id) => [id, ACTIONS[id].description])) as Record<ActionId, string>;
const focusCriteria = Object.fromEntries(FOCUS_IDS.map((id) => [id, FOCUS[id].description])) as Record<FocusId, string>;

const questions = {
	action: choice(
		{
			question: 'Which controller macro should Mario execute next?',
			goal: 'Move right toward the flagpole as fast as is safe. Never die.',
			simulated_outcomes:
				'When present, each entry is the real game run forward from this exact frame with that macro (jumps are followed by running right; other macros are repeated for two windows). Results are facts. `risk` summarizes each one: never pick fatal if another option is not fatal; pick low over high whenever a low option exists (high means Mario ends blocked or an enemy touches him within 10 frames, see `enemy_contact_after_frames`). Among the lowest-risk options prefer reaches_flagpole or stomps_enemy, then the most progress_px.',
			timing:
				'Non-jump macros last `timing.decision_window_frames`. Jump macros run to completion. `timing.reaction_horizon_frames` is how far the world moves before you decide again.',
			jumps:
				'If `timing.jump_must_start_now` is true and Mario is grounded, choose a jump now; waiting one more decision is too late. Use run_jump_high for walls of 2+ tiles, gaps, and when unsure. run_jump_low is enough for 1-tile walls and nearby stompable enemies.',
			enemies:
				'Touching an enemy from the side kills Mario. Landing on top of a stompable enemy defeats it. A moving_shell is fast and deadly: jump over it or back away. Never land on or walk into non-stompable enemies. Check the second and third enemy behind the nearest one before landing.',
			air:
				'While airborne (`mario.grounded` false) jumps cannot start. Use `landing`: if it says pit, keep run_right to reach the far edge; if it says enemy and the enemy is stompable, landing on it is good; brake with back_left or wait to avoid landing on a hazard.',
			stuck:
				'If `last_action.result` is blocked or `episode.stalled_decisions` grows, running is not working: jump.',
		},
		actionCriteria,
	),
	focus: choice('What is the single most important thing Mario must deal with right now?', focusCriteria),
	jump_now: noul(
		'Should Mario start a jump (or be in the middle of one) right now, given terrain, enemies and timing?',
	),
	danger: score('How dangerous is Mario’s immediate situation?', [
		'Safe: open path, nothing within reach',
		'Caution: an obstacle, gap or enemy is coming up',
		'Critical: collision, fall or enemy contact is imminent',
	]),
};

// The API may leave usage out (Laya, previews): count what it reports.
export const tokensOf = (usage: Usage) => (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);

const REQUEST = { retry: { maxRetries: 1 }, timeout: 8000 } as const;
const JUMPS = new Set<ActionId>(['run_jump_high', 'run_jump_low', 'jump_up']);

// Laya (local ModernBERT-large) reads 512 tokens and a JevState is 650 to 1000, so the
// simulated futures, its last field, never reached it: it picked almost at random and died three
// times at the first goombas of 1-1. It gets a shortlist instead: the futures with the lowest risk
// that still move right, each told in a few words, under opaque keys (A, B, C...). Adding the game
// state or the objective to the request made its picks worse, so the state is just the game's name.
const LAYA_QUESTION =
	'Which move should Mario make? Each option says what really happens when the game is played forward with it. Never pick a move where Mario dies or gets hurt. Prefer safe moves with the most progress.';
const LAYA_KEYS = 'ABCDEFG';
const MOVES: Record<ActionId, string> = {
	run_right: 'Run right',
	walk_right: 'Walk right slowly',
	run_jump_high: 'Long high running jump',
	run_jump_low: 'Short low hop',
	jump_up: 'Jump straight up',
	wait: 'Stop and wait',
	back_left: 'Move back left',
};
// With no futures (turn mode on a clear path) any forward move is fine.
const CLEAR_PATH: ActionId[] = ['run_right', 'run_jump_high', 'run_jump_low'];
const RISK_RANK: Record<string, number> = { low: 0, high: 1, fatal: 2 };

type Futures = NonNullable<JevState['simulated_outcomes']>;
type Future = NonNullable<Futures[ActionId]>;

/** The lowest-risk futures that move right or, when none does, that back away for a run-up. */
function shortlist(futures: Futures): ActionId[] {
	const simulated = ACTION_IDS.filter((id) => futures[id]);
	const lowest = Math.min(...simulated.map((id) => RISK_RANK[futures[id]!.risk]!));
	const safest = simulated.filter((id) => RISK_RANK[futures[id]!.risk] === lowest);
	const forward = safest.filter((id) => futures[id]!.progress_px > 0);
	if (forward.length) return forward;
	// Offered `wait`, Laya stood at the edge of the first pit for good: a jump needs a run-up.
	const back = safest.filter((id) => futures[id]!.progress_px < 0);
	return back.length ? back : safest;
}

function told(future: Future, top: number): string {
	if (future.result === 'dies' || future.result === 'dies_after_landing') return 'Mario dies';
	if (future.result === 'falls_in_pit') return 'Mario falls in a pit and dies';
	if (future.result === 'takes_damage') return 'an enemy hurts Mario';
	const parts = [
		future.result === 'reaches_flagpole' && 'reaches the flagpole',
		future.result === 'stomps_enemy' && 'stomps the enemy',
		future.result === 'blocked' ? 'Mario gets stuck against a wall' : future.risk === 'high' ? 'an enemy is about to touch Mario' : 'safe',
		future.progress_px <= 0 ? 'no progress' : future.progress_px >= top * 0.75 ? 'the most progress' : 'little progress',
	];
	return parts.filter(Boolean).join(', ');
}

async function decideWithLaya(client: TypeSafeClient, state: JevState, signal: AbortSignal | undefined, started: number): Promise<Decision> {
	const futures = state.simulated_outcomes;
	const moves = futures && Object.keys(futures).length ? shortlist(futures) : CLEAR_PATH;
	const focus = focusFrom(state);
	const danger = dangerFrom(state);
	if (moves.length === 1) {
		// Nothing left to choose: no request.
		const [only] = moves as [ActionId];
		return pack({ choice: only, confidence: 1, probabilities: { [only]: 1 } }, focus, Number(JUMPS.has(only)), danger, started, 'shortlist', undefined, 0);
	}
	const top = futures ? Math.max(...moves.map((id) => futures[id]!.progress_px)) : 0;
	const criteria = Object.fromEntries(
		moves.map((id, i) => [LAYA_KEYS[i]!, futures?.[id] ? `${MOVES[id]}: ${told(futures[id]!, top)}` : MOVES[id]]),
	);
	const { data, requestId } = await client
		.systemOne({ state: 'Super Mario Bros.', questions: { action: choice(LAYA_QUESTION, criteria) } }, { signal, ...REQUEST })
		.withResponse();
	const answer = data.answers.action;
	const moveOf = (key: string) => moves[LAYA_KEYS.indexOf(key)]!;
	const probabilities: Decision['probabilities'] = Object.fromEntries(
		Object.entries(answer.probabilities).map(([key, probability]) => [moveOf(key), probability]),
	);
	const jumpNow = [...JUMPS].reduce((sum, id) => sum + (probabilities[id] ?? 0), 0);
	const action = { choice: moveOf(answer.choice), confidence: answer.confidence, probabilities };
	return pack(action, focus, jumpNow, danger, started, data.model, requestId, tokensOf(data.usage));
}

// Laya only answers `action`: focus and danger for the UI are worked out here.
function focusFrom(state: JevState): FocusId {
	if (!state.mario.grounded && state.landing) return 'landing';
	const flagpole = state.terrain.flagpole_distance_tiles;
	if (flagpole !== null && flagpole <= 8) return 'flagpole';
	const enemy = state.enemies.find((item) => item.position === 'ahead' && item.distance_px < 176);
	if (enemy) return 'enemy';
	if (state.terrain.gap && state.terrain.gap.distance_tiles <= 6) return 'gap';
	if (state.terrain.wall && state.terrain.wall.distance_tiles <= 5) return 'wall';
	return 'clear_path';
}

function dangerFrom(state: JevState): number {
	const enemy = state.enemies.find((item) => item.position === 'ahead');
	if (state.timing.jump_must_start_now) return 2;
	if (enemy && enemy.frames_to_contact !== null && enemy.frames_to_contact <= 12) return 2;
	if (state.terrain.gap && state.terrain.gap.distance_tiles <= 3) return 2;
	if (enemy || state.terrain.gap || (state.terrain.wall && state.terrain.wall.distance_tiles <= 4)) return 1;
	return 0;
}

function pack(
	action: { choice: ActionId; confidence: number; probabilities: Decision['probabilities'] },
	focus: FocusId,
	jumpNow: number,
	danger: number,
	started: number,
	model: string,
	requestId: string | undefined,
	tokens: number,
): Decision {
	return {
		action: action.choice,
		confidence: action.confidence,
		probabilities: action.probabilities,
		focus,
		jumpNow,
		danger,
		latencyMs: Math.round(performance.now() - started),
		model,
		requestId,
		tokens,
	};
}

export async function decide(
	client: TypeSafeClient,
	state: JevState,
	signal?: AbortSignal,
	backend: 'jev' | 'laya' = 'jev',
): Promise<Decision> {
	const started = performance.now();
	if (backend === 'laya') return decideWithLaya(client, state, signal, started);
	const game = state as unknown as Record<string, never>;
	const { data, requestId } = await client.systemOne({ state: game, questions }, { signal, ...REQUEST }).withResponse();
	const { action, focus, jump_now, danger } = data.answers;
	return pack(action, focus.choice, jump_now.noul, danger.score, started, data.model, requestId, tokensOf(data.usage));
}
