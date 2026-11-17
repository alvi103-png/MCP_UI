// The dev server serves games/Super Mario Bros. (World).nes at this path.
// games/ is gitignored, so a deploy answers 404 and the page falls back to a local file.
const LOCAL_ROM = '/games/super-mario-bros.nes';

const DB = 'jev-mario';
const STORE = 'rom';

function open() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function read(): Promise<Uint8Array | null> {
	try {
		const db = await open();
		return await new Promise((resolve) => {
			const request = db.transaction(STORE).objectStore(STORE).get('nes');
			request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result) : null);
			request.onerror = () => resolve(null);
		});
	} catch {
		return null;
	}
}

async function write(bytes: Uint8Array) {
	try {
		const db = await open();
		db.transaction(STORE, 'readwrite').objectStore(STORE).put(bytes.buffer, 'nes');
	} catch {}
}

const isNes = (bytes: Uint8Array) => bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a;

async function fromDevServer(): Promise<Uint8Array | null> {
	try {
		const response = await fetch(LOCAL_ROM);
		if (!response.ok) return null;
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (!isNes(bytes)) return null;
		await write(bytes);
		return bytes;
	} catch {
		return null;
	}
}

/** Uses the local games ROM when the dev server has it, then IndexedDB, then a picked or dropped .nes file. */
export async function loadRom(target: HTMLElement, input: HTMLInputElement, onInvalid: () => void): Promise<Uint8Array> {
	const local = await fromDevServer();
	if (local) return local;
	const cached = await read();
	if (cached && isNes(cached)) return cached;
	target.dataset.needsRom = 'true';
	return new Promise((resolve) => {
		const accept = async (file: File | undefined) => {
			if (!file) return;
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (!isNes(bytes)) return onInvalid();
			await write(bytes);
			delete target.dataset.needsRom;
			resolve(bytes);
		};
		input.addEventListener('change', () => accept(input.files?.[0]));
		target.addEventListener('dragover', (event) => event.preventDefault());
		target.addEventListener('drop', (event) => {
			event.preventDefault();
			accept(event.dataTransfer?.files[0]);
		});
	});
}
