// Controller macros Jev can choose from. Each macro is a short frame program so
// jump height and duration are executed exactly, whatever the inference latency.

export const BUTTON = {
	A: 1 << 0,
	B: 1 << 1,
	SELECT: 1 << 2,
	START: 1 << 3,
	UP: 1 << 4,
	DOWN: 1 << 5,
	LEFT: 1 << 6,
	RIGHT: 1 << 7,
} as const;

export type Buttons = number;

export const ACTION_IDS = [
	'run_right',
	'walk_right',
	'run_jump_high',
	'run_jump_low',
	'jump_up',
	'wait',
	'back_left',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface Segment {
	frames: number;
	buttons: Buttons;
}

export interface ActionSpec {
	/** Short Spanish label for the UI. */
	label: string;
	/** Model-facing description (the criteria text Jev reads). */
	description: string;
	/** Builds the frame program. `hold` is the frames per decision for non-jump macros. */
	program: (hold: number) => Segment[];
	jump: boolean;
	color: string;
}

const { A, B, LEFT, RIGHT } = BUTTON;

export const ACTIONS: Record<ActionId, ActionSpec> = {
	run_right: {
		label: 'correr',
		description:
			'Hold right + B for one decision window. Fastest progress. Only when the next few tiles are free of walls, gaps and enemies that would be reached before the next decision.',
		program: (hold) => [{ frames: hold, buttons: RIGHT | B }],
		jump: false,
		color: '#fafafa',
	},
	walk_right: {
		label: 'caminar',
		description:
			'Hold right at walking speed for one decision window. Slower and more precise: use it to approach an enemy or edge while waiting for a good takeoff moment.',
		program: (hold) => [{ frames: hold, buttons: RIGHT }],
		jump: false,
		color: '#a3a3a3',
	},
	run_jump_high: {
		label: 'salto largo',
		description:
			'Running jump holding A for 24 frames: maximum height (about 4 tiles) and distance (about 5 tiles at full speed). Use it for pipes, tall walls, stairs, gaps, and to clear or stomp enemies. Only starts a jump when grounded.',
		program: () => [{ frames: 24, buttons: RIGHT | B | A }],
		jump: true,
		color: '#ff313c',
	},
	run_jump_low: {
		label: 'salto corto',
		description:
			'Short running hop: A held for 6 frames, then keep running. About 1-2 tiles high. Use it for single blocks, narrow gaps, or to stomp a nearby ground enemy without flying over it. Only starts a jump when grounded.',
		program: (hold) => [
			{ frames: 6, buttons: RIGHT | B | A },
			{ frames: Math.max(4, hold), buttons: RIGHT | B },
		],
		jump: true,
		color: '#ffb300',
	},
	jump_up: {
		label: 'salto vertical',
		description:
			'Jump straight up holding A for 24 frames without moving forward. Use it to hit a block above, or to dodge an enemy while keeping position. Only starts a jump when grounded.',
		program: () => [{ frames: 24, buttons: A }],
		jump: true,
		color: '#00a5a1',
	},
	wait: {
		label: 'esperar',
		description:
			'Release all buttons for one decision window and let momentum fade. Use it to let an enemy approach into a better stomping position, to wait for a piranha plant to hide, or mid-air to stop drifting forward.',
		program: (hold) => [{ frames: hold, buttons: 0 }],
		jump: false,
		color: '#737373',
	},
	back_left: {
		label: 'retroceder',
		description:
			'Hold left for one decision window. Use it to back away from danger, or mid-air to brake so Mario lands on an enemy or short of a hazard.',
		program: (hold) => [{ frames: hold, buttons: LEFT }],
		jump: false,
		color: '#6d8dfa',
	},
};

export const programLength = (segments: Segment[]) => segments.reduce((total, segment) => total + segment.frames, 0);

export const buttonsAt = (segments: Segment[], frame: number): Buttons => {
	let offset = frame;
	for (const segment of segments) {
		if (offset < segment.frames) return segment.buttons;
		offset -= segment.frames;
	}
	return 0;
};

// What Jev says it is paying attention to. Only used to explain decisions in the UI.
export const FOCUS_IDS = ['clear_path', 'enemy', 'wall', 'gap', 'landing', 'flagpole'] as const;

export type FocusId = (typeof FOCUS_IDS)[number];

export const FOCUS: Record<FocusId, { label: string; description: string }> = {
	clear_path: { label: 'camino libre', description: 'Nothing threatening within reach: keep making progress.' },
	enemy: { label: 'enemigo', description: 'An enemy must be jumped over, stomped or avoided.' },
	wall: { label: 'obstáculo', description: 'A pipe, block column or staircase blocks the way.' },
	gap: { label: 'hueco', description: 'A bottomless pit or gap must be crossed.' },
	landing: { label: 'aterrizaje', description: 'Mario is in the air and must steer to land safely.' },
	flagpole: { label: 'bandera', description: 'The flagpole is in sight: finish the level.' },
};
