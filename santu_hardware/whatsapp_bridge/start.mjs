import { webcrypto } from "node:crypto";

if (!globalThis.crypto || !globalThis.crypto.subtle) {
	globalThis.crypto = webcrypto;
}

await import("./bridge.js");
