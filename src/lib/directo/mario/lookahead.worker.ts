import { Lookahead, type LookaheadRequest } from './lookahead.ts';

let lookahead: Lookahead | null = null;

self.onmessage = (event: MessageEvent<{ id: number; rom?: Uint8Array; request?: LookaheadRequest }>) => {
	const { id, rom, request } = event.data;
	if (rom) {
		lookahead = new Lookahead(rom);
		return;
	}
	if (!lookahead || !request) return;
	const result = lookahead.run(request);
	self.postMessage({ id, result });
};
