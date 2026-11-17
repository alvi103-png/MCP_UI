// Browser UI: runs the emulator at 60 fps, asks Jev through /api/jev/mario and
// draws what Jev sees (vision), what could happen (futures) and what it chose.
// The `screen` variant (/mario-captura) sends Jev only a screenshot through /api/jev/mario-screen.

import { ACTION_IDS, ACTIONS, type ActionId, BUTTON, FOCUS } from './actions.ts';
import { type Decision, Emulator, MarioAgent, type Mode, type Policy, riskOf, type ScreenVision } from './agent.ts';
import type { OutcomeResult } from './lookahead.ts';
import { LookaheadPool } from './lookahead-pool.ts';
import { loadRom } from './rom.ts';
import { conToken } from '../token.ts';
import { SCREEN_H, SCREEN_W } from './perception.ts';
import { GRID_ROWS, GRID_TOP, TILE } from './ram.ts';
import { CROP, captureRgba, encodePng, SCREEN_ACTIONS, SHOT_H, SHOT_W, type ShotBox } from './screen.ts';

const FRAME_MS = 1000 / 60;
// jsnes leaves an 8 px black border (the TV overscan area); the page shows the visible 240x224.
const VIEW_W = SCREEN_W - CROP * 2;
const VIEW_H = SCREEN_H - CROP * 2;
const RED = '#ff313c';
const YELLOW = '#ffb300';
const TEAL = '#00a5a1';

const RESULT_LABEL: Record<OutcomeResult, string> = {
	safe: 'ok',
	stomps_enemy: 'pisa',
	takes_damage: 'daño',
	dies: 'muere',
	dies_after_landing: 'muere',
	falls_in_pit: 'cae',
	blocked: 'bloqueado',
	reaches_flagpole: 'bandera',
};

const RISK_COLOR = { low: TEAL, high: YELLOW, fatal: RED } as const;

interface TimelineMark {
	color: string;
	danger: number;
	event?: 'death' | 'clear';
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

type Backend = 'jev' | 'laya';

/** ram: RAM JSON plus simulated futures, Jev or Laya. screen: Jev with nothing but a screenshot. */
export type Variant = 'ram' | 'screen';

function storedBackend(): Backend {
	return localStorage.getItem('mario-backend') === 'laya' ? 'laya' : 'jev';
}

export async function startMarioDemo(variant: Variant = 'ram') {
	const screenOnly = variant === 'screen';
	const screen = $<HTMLCanvasElement>('#screen');
	const vision = $<HTMLCanvasElement>('#vision');
	const timeline = $<HTMLCanvasElement>('#timeline');
	const stage = $('#stage');
	const status = $('#status');

	// Laya has no image input: the screenshot demo is Jev only.
	let backend: Backend = screenOnly ? 'jev' : storedBackend();
	const setBackend = (next: Backend) => {
		if (screenOnly) return;
		backend = next;
		localStorage.setItem('mario-backend', next);
		for (const button of document.querySelectorAll<HTMLButtonElement>('[data-backend]')) {
			button.setAttribute('aria-pressed', String(button.dataset.backend === next));
		}
		$('#seen').textContent = `lo que ve ${next}`;
	};
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-backend]')) {
		button.addEventListener('click', () => setBackend(button.dataset.backend as Backend));
	}
	setBackend(backend);

	const rom = await loadRom(stage, $<HTMLInputElement>('#rom'), () => {
		status.textContent = 'ese archivo no es una rom de nes';
		status.dataset.state = 'error';
	});

	const context = screen.getContext('2d')!;
	const image = context.createImageData(SCREEN_W, SCREEN_H);
	const pixels = new Uint32Array(image.data.buffer);
	let dirty = false;
	const emulator = new Emulator(rom, (buffer) => {
		for (let i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | buffer[i]!;
		dirty = true;
	});

	const ask = async (url: string, init: RequestInit) => {
		const res = await fetch(url, { method: 'POST', ...init, headers: conToken(init.headers as Record<string, string>) });
		const data = (await res.json()) as Decision & { error?: string | { message: string } };
		if (!res.ok) throw new Error((typeof data.error === 'object' ? data.error.message : data.error) ?? res.statusText);
		return data;
	};
	const ramPolicy: Policy = (state, signal) =>
		ask('/api/directo/mario', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, backend }), signal });
	const shot = document.querySelector<HTMLImageElement>('#shot');
	const shotBoxes = document.querySelector<SVGSVGElement>('#shot-boxes');
	const screenPolicy: Policy = async (_state, signal, predicted) => {
		// In real time, the picture of the frame where the answer will land. In turns, the
		// agent calls this on the frame of the request, so the copy is exactly that frame.
		const png = await encodePng(captureRgba(predicted ?? pixels));
		if (shot) {
			if (shot.src) URL.revokeObjectURL(shot.src);
			shot.src = URL.createObjectURL(png);
			shot.hidden = false;
			// The boxes belong to the previous shot until Jev answers about this one.
			shotBoxes?.replaceChildren();
		}
		return ask(`/api/jev/mario-screen?mode=${agent.mode}`, { headers: { 'content-type': 'image/png' }, body: png, signal });
	};

	// The screenshot demo only plays the committed buttons ahead: one worker is enough.
	const pool = new LookaheadPool(rom, screenOnly ? 1 : undefined);
	const agent = new MarioAgent(emulator, screenOnly ? screenPolicy : ramPolicy, {
		simulate: (request) => pool.run(request),
		// Both start in turns. With only the picture, Jev clears 1-1 in turns but not in real time,
		// where its answers come further apart than the few frames a jump can be timed in.
		mode: 'sync',
	});
	if (screenOnly) {
		agent.lookahead = false;
		agent.shield = false;
		agent.decideInAir = false;
		agent.predictScreen = true;
	}

	// Handy from the devtools console during the talk.
	Object.assign(window, { jev: agent });

	const ui = {
		// The RAM overlay is not what the screenshot demo sends, so it starts hidden there.
		showVision: !screenOnly,
		marks: [] as TimelineMark[],
		outcomesId: 0,
	};

	// --- Controls -----------------------------------------------------------

	const toggle = $<HTMLButtonElement>('#toggle');
	const play = () => {
		agent.play();
		stage.dataset.started = 'true';
	};
	const togglePlay = () => (agent.running ? agent.pause() : play());
	const setMode = (mode: Mode) => {
		agent.mode = mode;
		for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
			button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
		}
	};
	// Futures, shield and vision only exist in the RAM demo.
	const toggleFutures = () => {
		if (screenOnly) return;
		agent.lookahead = !agent.lookahead;
		$('#futures').setAttribute('aria-pressed', String(agent.lookahead));
	};
	const toggleShield = () => {
		if (screenOnly) return;
		agent.shield = !agent.shield;
		$('#shield').setAttribute('aria-pressed', String(agent.shield));
	};
	const toggleVision = () => {
		if (screenOnly) return;
		ui.showVision = !ui.showVision;
		$('#vision-toggle').setAttribute('aria-pressed', String(ui.showVision));
	};
	const restart = () => {
		agent.restart();
		ui.marks = [];
		play();
	};

	toggle.addEventListener('click', togglePlay);
	$('#start').addEventListener('click', play);
	$('#step').addEventListener('click', () => agent.stepOnce());
	$('#restart').addEventListener('click', restart);
	document.querySelector('#futures')?.addEventListener('click', toggleFutures);
	document.querySelector('#vision-toggle')?.addEventListener('click', toggleVision);
	document.querySelector('#shield')?.addEventListener('click', toggleShield);
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
		button.addEventListener('click', () => setMode(button.dataset.mode as Mode));
	}
	window.addEventListener('keydown', (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement) return;
		const key = event.key.toLowerCase();
		const actions: Record<string, () => void> = {
			' ': togglePlay,
			n: () => agent.stepOnce(),
			r: restart,
			m: () => setMode(agent.mode === 'sync' ? 'realtime' : 'sync'),
			f: toggleFutures,
			s: toggleShield,
			v: toggleVision,
			l: () => setBackend(backend === 'jev' ? 'laya' : 'jev'),
		};
		const action = actions[key];
		if (!action) return;
		event.preventDefault();
		action();
	});

	// --- Agent events -------------------------------------------------------

	const rows = new Map<ActionId, HTMLElement>();
	const table = $('#actions');
	for (const id of screenOnly ? SCREEN_ACTIONS : ACTION_IDS) {
		const row = document.createElement('li');
		row.style.setProperty('--color', ACTIONS[id].color);
		row.innerHTML = `<span class="name">${ACTIONS[id].label}</span><span class="bar"><i></i></span><span class="pct">–</span><span class="future" title="futuro simulado"></span>`;
		table.appendChild(row);
		rows.set(id, row);
	}

	agent.on((event) => {
		if (event.type === 'request') {
			ui.outcomesId = event.id;
			const byAction = new Map(agent.outcomes.map((outcome) => [outcome.action, outcome]));
			for (const [id, row] of rows) {
				const outcome = byAction.get(id);
				const future = row.querySelector<HTMLElement>('.future')!;
				future.textContent = outcome ? RESULT_LABEL[outcome.result] : '';
				future.style.color = outcome ? RISK_COLOR[riskOf(outcome)] : '';
			}
			if (!screenOnly) $('#json').textContent = formatJson(event.state);
		}
		if (event.type === 'decision') {
			const { decision } = event.record;
			const spec = ACTIONS[decision.action];
			const action = $('#action');
			action.textContent = spec.label;
			action.style.color = spec.color;
			const shielded = $('#shielded');
			shielded.hidden = !decision.shieldedFrom;
			if (decision.shieldedFrom) shielded.textContent = `escudo · ${backend} quería ${ACTIONS[decision.shieldedFrom].label}`;
			for (const [id, row] of rows) {
				const probability = decision.probabilities[id] ?? 0;
				row.querySelector<HTMLElement>('i')!.style.width = `${Math.round(probability * 100)}%`;
				row.querySelector('.pct')!.textContent = `${Math.round(probability * 100)}`;
				row.toggleAttribute('data-chosen', id === decision.action);
			}
			$('#focus').textContent = FOCUS[decision.focus]?.label ?? decision.focus;
			setGauge('#danger', decision.danger / 2);
			setGauge('#jump', decision.jumpNow);
			setGauge('#confidence', decision.confidence);
			$('#latency').textContent = `${decision.latencyMs} ms`;
			// How many frames old the screenshot is when its answer starts playing.
			if (screenOnly) $('#delay').textContent = `${event.record.delayFrames} frames`;
			if (shotBoxes) drawShotBoxes(shotBoxes, decision.vision);
			ui.marks.push({ color: spec.color, danger: decision.danger / 2 });
		}
		if (event.type === 'death') ui.marks.push({ color: RED, danger: 1, event: 'death' });
		if (event.type === 'clear') ui.marks.push({ color: TEAL, danger: 1, event: 'clear' });
		if (event.type === 'error') {
			agent.pause();
			status.dataset.state = 'error';
			status.textContent = `error · ${event.message}`.slice(0, 80);
		}
		if (event.type === 'decision' || event.type === 'death' || event.type === 'clear') drawTimeline(timeline, ui.marks);
	});

	// --- Render loop --------------------------------------------------------

	let last = performance.now();
	let pending = 0;
	let lastPanel = 0;
	const loop = (now: number) => {
		pending += Math.min(100, now - last);
		last = now;
		let steps = 0;
		while (pending >= FRAME_MS && steps < 4) {
			// Before the first play, let the title screen run on its own.
			if (!stage.dataset.started) {
				emulator.step(0);
				pending -= FRAME_MS;
				steps++;
				continue;
			}
			const result = agent.tick();
			if (result !== 'advanced') {
				pending = 0;
				break;
			}
			pending -= FRAME_MS;
			steps++;
		}
		if (dirty) {
			context.putImageData(image, -CROP, -CROP);
			dirty = false;
		}
		drawVision(vision, agent, ui, now);
		if (now - lastPanel > 80) {
			lastPanel = now;
			updateLive(agent, toggle, status, backend);
		}
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
	stage.dataset.ready = 'true';
}

const TILES = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const KIND_LABEL = { enemy: FOCUS.enemy.label, wall: FOCUS.wall.label, pit: FOCUS.gap.label } as const;

/** Jev's boxes on the shot it was sent: Mario, the hazard and the gap the code measured between them. */
function drawShotBoxes(svg: SVGSVGElement, vision: ScreenVision | undefined) {
	if (!vision) return svg.replaceChildren();
	const rect = (box: ShotBox, kind: string) =>
		`<rect class="${kind}" x="${box.left * SHOT_W}" y="${box.top * SHOT_H}" width="${(box.right - box.left) * SHOT_W}" height="${(box.bottom - box.top) * SHOT_H}" />`;
	let markup = rect(vision.mario, 'mario');
	if (vision.hazard && vision.kind && vision.gapPx !== null) {
		markup += rect(vision.hazard, 'hazard');
		const y = vision.mario.bottom * SHOT_H - 8;
		const from = vision.mario.right * SHOT_W;
		const to = Math.max(from, vision.hazard.left * SHOT_W);
		const label = `${KIND_LABEL[vision.kind]} · ${TILES.format(vision.gapPx / TILE)} bloques`;
		// The label grows away from the nearer edge so it never leaves the picture.
		const left = vision.mario.left * SHOT_W;
		const text = left < SHOT_W / 2 ? `x="${left}"` : `x="${to}" text-anchor="end"`;
		markup += `<line x1="${from}" x2="${to}" y1="${y}" y2="${y}" /><text ${text} y="${vision.mario.top * SHOT_H - 8}">${label}</text>`;
	}
	svg.innerHTML = markup;
}

function setGauge(selector: string, value: number) {
	const gauge = $(selector);
	gauge.style.setProperty('--value', String(Math.max(0, Math.min(1, value))));
	gauge.querySelector('output')!.textContent = `${Math.round(value * 100)}`;
}

function updateLive(agent: MarioAgent, toggle: HTMLButtonElement, status: HTMLElement, backend: Backend) {
	const frame = agent.frame;
	const buttons = agent.emulator.buttons;
	for (const [name, bit] of Object.entries({ left: BUTTON.LEFT, right: BUTTON.RIGHT, a: BUTTON.A, b: BUTTON.B })) {
		$(`#pad-${name}`).toggleAttribute('data-on', (buttons & bit) !== 0);
	}
	toggle.textContent = agent.running ? 'pausa' : 'jugar';
	toggle.setAttribute('aria-pressed', String(agent.running));
	if (status.dataset.state !== 'error' || agent.running) {
		const state = !agent.running ? 'paused' : agent.thinking ? 'thinking' : 'playing';
		status.dataset.state = state;
		status.textContent = { paused: 'en pausa', thinking: `${backend} piensa`, playing: `${backend} juega` }[state];
	}
	if (frame) {
		$('#level').textContent = `${frame.world}-${frame.stage}`;
		$('#lives').textContent = String(frame.lives);
		$('#time').textContent = String(frame.time).padStart(3, '0');
	}
	const latencies = [...agent.stats.latencies].sort((a, b) => a - b);
	$('#decisions').textContent = String(agent.stats.decisions);
	$('#p50').textContent = latencies.length ? `${latencies[Math.floor(latencies.length / 2)]}` : '–';
	$('#deaths').textContent = String(agent.stats.deaths);
}

function drawVision(
	canvas: HTMLCanvasElement,
	agent: MarioAgent,
	ui: { showVision: boolean; outcomesId: number },
	now: number,
) {
	const ratio = window.devicePixelRatio || 1;
	const width = Math.round(canvas.clientWidth * ratio);
	const height = Math.round(canvas.clientHeight * ratio);
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const ctx = canvas.getContext('2d')!;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, width, height);
	const frame = agent.frame;
	if (!frame || agent.phase !== 'playing') return;
	const scale = width / VIEW_W;
	ctx.scale(scale, height / VIEW_H);
	ctx.translate(-CROP, -CROP);
	const line = 1 / scale;

	if (ui.showVision) {
		const { terrain } = frame;
		// Gaps and walls Jev is told about.
		if (terrain.gap) {
			ctx.fillStyle = 'rgba(255, 49, 60, 0.28)';
			const x = terrain.gap.column * TILE - frame.screenLeft;
			const top = GRID_TOP + (terrain.referenceRow + 1) * TILE;
			ctx.fillRect(x, top, terrain.gap.width * TILE, SCREEN_H - top);
		}
		if (terrain.wall) {
			ctx.strokeStyle = YELLOW;
			ctx.lineWidth = line * 2;
			const x = terrain.wall.column * TILE - frame.screenLeft;
			const top = GRID_TOP + (terrain.referenceRow - terrain.wall.height + 1) * TILE;
			ctx.strokeRect(x, top, TILE, terrain.wall.height * TILE);
		}
		// Profile ahead: a thin line on each surface Jev measured.
		ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
		for (const column of terrain.columns) {
			if (column.surface === null) continue;
			const row = terrain.referenceRow + 1 - Math.max(0, column.surface) + Math.max(0, -column.surface);
			if (row < 0 || row > GRID_ROWS) continue;
			ctx.fillRect(column.column * TILE - frame.screenLeft + 2, GRID_TOP + row * TILE - line, TILE - 4, line * 2);
		}
		for (const enemy of frame.enemies) {
			ctx.strokeStyle = enemy.defeated ? 'rgba(255,255,255,0.3)' : enemy.stompable ? YELLOW : RED;
			ctx.lineWidth = line * 2;
			ctx.strokeRect(enemy.box.x + 0.5, enemy.box.y + 0.5, enemy.box.w - 1, enemy.box.h - 1);
			if (!enemy.defeated && Math.abs(enemy.vx) > 0.05) {
				const cx = enemy.box.x + 8;
				const cy = enemy.box.y - 4;
				const dx = Math.sign(enemy.vx) * Math.min(12, 4 + Math.abs(enemy.vx) * 4);
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(cx + dx, cy);
				ctx.lineTo(cx + dx - Math.sign(dx) * 3, cy - 2);
				ctx.moveTo(cx + dx, cy);
				ctx.lineTo(cx + dx - Math.sign(dx) * 3, cy + 2);
				ctx.stroke();
			}
		}
		if (frame.powerup) {
			ctx.strokeStyle = TEAL;
			ctx.strokeRect(frame.powerup.box.x + 0.5, frame.powerup.box.y + 0.5, 15, 15);
		}
		ctx.strokeStyle = 'rgba(255,255,255,0.9)';
		ctx.lineWidth = line * 1.5;
		ctx.strokeRect(frame.marioBox.x + 0.5, frame.marioBox.y + 0.5, frame.marioBox.w - 1, frame.marioBox.h - 1);
	}

	// Simulated futures: one ghost trajectory per candidate. Once Jev answers,
	// the chosen one stays bold and the rejected ones fade.
	if (agent.lookahead && agent.outcomes.length) {
		const record = agent.lastRecord;
		const chosen = record && record.id === ui.outcomesId ? record.decision.action : null;
		for (const outcome of agent.outcomes) {
			const isChosen = outcome.action === chosen;
			const risk = riskOf(outcome);
			ctx.globalAlpha = chosen ? (isChosen ? 1 : 0.18) : 0.7;
			ctx.fillStyle = risk === 'fatal' ? RED : ACTIONS[outcome.action].color;
			const size = isChosen ? 3 : 2;
			outcome.path.forEach(([x, y], index) => {
				if (index % 2) return;
				ctx.fillRect(x - frame.screenLeft + 8 - size / 2, y + 8 - size / 2, size, size);
			});
			const endPoint = outcome.path.at(-1);
			if (endPoint && risk === 'fatal') {
				const ex = endPoint[0] - frame.screenLeft + 8;
				const ey = Math.min(SCREEN_H - 6, endPoint[1] + 8);
				ctx.strokeStyle = RED;
				ctx.lineWidth = line * 2;
				ctx.beginPath();
				ctx.moveTo(ex - 3, ey - 3);
				ctx.lineTo(ex + 3, ey + 3);
				ctx.moveTo(ex + 3, ey - 3);
				ctx.lineTo(ex - 3, ey + 3);
				ctx.stroke();
			}
		}
		ctx.globalAlpha = 1;
	}

	// Thinking indicator above Mario's head.
	if (agent.thinking) {
		const x = frame.marioBox.x + 8;
		const y = frame.marioBox.y - 8;
		for (let i = 0; i < 3; i++) {
			const on = Math.floor(now / 160) % 3 === i;
			ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.35)';
			ctx.fillRect(x - 6 + i * 5, y, 3, 3);
		}
	}
}

function drawTimeline(canvas: HTMLCanvasElement, marks: TimelineMark[]) {
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.round(canvas.clientWidth * ratio);
	canvas.height = Math.round(canvas.clientHeight * ratio);
	const ctx = canvas.getContext('2d')!;
	const bar = 3 * ratio;
	const gap = 1 * ratio;
	const capacity = Math.floor(canvas.width / (bar + gap));
	const visible = marks.slice(-capacity);
	visible.forEach((mark, index) => {
		const x = index * (bar + gap);
		const h = mark.event ? canvas.height : Math.max(3 * ratio, canvas.height * (0.3 + mark.danger * 0.7));
		ctx.fillStyle = mark.color;
		ctx.globalAlpha = mark.event ? 1 : 0.85;
		ctx.fillRect(x, canvas.height - h, mark.event ? bar + gap : bar, h);
	});
	ctx.globalAlpha = 1;
}

/** Pretty JSON that keeps arrays of plain values on a single line. */
function formatJson(value: unknown) {
	return JSON.stringify(value, null, 2).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (_, items: string) => `[${items.split(/,\s*/).join(', ')}]`);
}
