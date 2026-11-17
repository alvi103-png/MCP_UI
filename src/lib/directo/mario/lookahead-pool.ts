// Spreads candidate simulations over a few workers so the main thread keeps rendering.

import type { LookaheadRequest, LookaheadResult, Outcome } from './lookahead.ts';

export class LookaheadPool {
	private workers: Worker[];
	private nextId = 1;
	private waiting = new Map<number, (result: LookaheadResult) => void>();

	constructor(rom: Uint8Array, size = Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1))) {
		this.workers = Array.from({ length: size }, () => {
			const worker = new Worker(new URL('./lookahead.worker.ts', import.meta.url), { type: 'module' });
			worker.postMessage({ id: 0, rom });
			worker.onmessage = (event: MessageEvent<{ id: number; result: LookaheadResult }>) => {
				this.waiting.get(event.data.id)?.(event.data.result);
				this.waiting.delete(event.data.id);
			};
			return worker;
		});
	}

	async run(request: LookaheadRequest): Promise<LookaheadResult> {
		const groups = this.workers.map((_, index) => request.candidates.filter((__, i) => i % this.workers.length === index));
		const results = await Promise.all(
			groups.map((candidates, index) => {
				// The first worker always runs: it plays the prefix even when there is nothing to compare.
				if (!candidates.length && index > 0) return Promise.resolve({ outcomes: [], ram: null } as LookaheadResult);
				const id = this.nextId++;
				return new Promise<LookaheadResult>((resolve) => {
					this.waiting.set(id, resolve);
					this.workers[index]!.postMessage({ id, request: { ...request, candidates } });
				});
			}),
		);
		const byAction = new Map<string, Outcome>(results.flatMap((result) => result.outcomes.map((outcome) => [outcome.action, outcome])));
		return {
			outcomes: request.candidates.map((action) => byAction.get(action)!).filter(Boolean),
			ram: results.find((result) => result.ram)?.ram ?? null,
			screen: results.find((result) => result.screen)?.screen ?? null,
		};
	}

	destroy() {
		for (const worker of this.workers) worker.terminate();
	}
}
