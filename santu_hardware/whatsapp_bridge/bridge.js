import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import makeWASocket, {
	useMultiFileAuthState,
	DisconnectReason,
	fetchLatestBaileysVersion,
	fetchLatestWaWebVersion,
	makeCacheableSignalKeyStore,
	Browsers,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SANTU_WA_PORT || 18765);
const AUTH_DIR = process.env.SANTU_WA_AUTH_DIR || path.join(__dirname, "auth");
const STATUS_FILE = process.env.SANTU_WA_STATUS_FILE || path.join(__dirname, "status.json");

fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock = null;
let starting = false;

function writeStatus(partial) {
	let cur = {};
	try {
		cur = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
	} catch (e) {
		cur = {};
	}
	const next = Object.assign(
		{ state: "DISCONNECTED", qr: "", phone: "", error: "", updated_at: Date.now() },
		cur,
		partial,
		{ updated_at: Date.now() }
	);
	fs.writeFileSync(STATUS_FILE, JSON.stringify(next));
	return next;
}

function readStatus() {
	try {
		return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
	} catch (e) {
		return { state: "DISCONNECTED", qr: "", phone: "", error: "" };
	}
}

process.on("uncaughtException", (e) => {
	writeStatus({ state: "ERROR", qr: "", error: String(e && e.message ? e.message : e) });
});
process.on("unhandledRejection", (e) => {
	writeStatus({ state: "ERROR", qr: "", error: String(e && e.message ? e.message : e) });
});

async function latestWaVersion() {
	try {
		const live = await fetchLatestWaWebVersion({});
		if (live && live.version) return live.version;
	} catch (e) {}
	const baked = await fetchLatestBaileysVersion();
	return baked.version;
}

async function startSocket() {
	if (starting || sock) return;
	starting = true;
	try {
		const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
		const version = await latestWaVersion();
		const logger = pino({ level: "silent" });
		writeStatus({ state: "CONNECTING", error: "" });

		sock = makeWASocket({
			version,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger),
			},
			printQRInTerminal: false,
			logger,
			browser: Browsers.macOS("Chrome"),
			syncFullHistory: false,
			markOnlineOnConnect: true,
			connectTimeoutMs: 60_000,
		});

		sock.ev.on("creds.update", saveCreds);
		sock.ev.on("connection.update", async (update) => {
			const { connection, lastDisconnect, qr } = update;
			if (qr) {
				try {
					const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1, errorCorrectionLevel: "M" });
					writeStatus({ state: "QR", qr: dataUrl, error: "" });
				} catch (e) {
					writeStatus({ state: "ERROR", qr: "", error: "QR draw failed: " + String(e.message || e) });
				}
			}
			if (connection === "open") {
				const me = sock.user && (sock.user.id || "");
				const phone = String(me).split(":")[0].split("@")[0];
				writeStatus({ state: "CONNECTED", qr: "", phone, error: "" });
			}
			if (connection === "close") {
				const code =
					lastDisconnect &&
					lastDisconnect.error &&
					lastDisconnect.error.output &&
					lastDisconnect.error.output.statusCode;
				sock = null;
				starting = false;
				if (code === DisconnectReason.loggedOut) {
					writeStatus({ state: "LOGGED_OUT", qr: "", phone: "", error: "Logged out. Scan QR again." });
					try {
						fs.rmSync(AUTH_DIR, { recursive: true, force: true });
						fs.mkdirSync(AUTH_DIR, { recursive: true });
					} catch (e) {}
					return;
				}
				// 515 = restartRequired: normal after QR scan. Reconnect immediately
				// with the new creds or the phone shows "Couldn't link device".
				writeStatus({
					state: "CONNECTING",
					qr: "",
					error: code === DisconnectReason.restartRequired ? "" : "",
				});
				const delay = code === DisconnectReason.restartRequired ? 0 : 1500;
				setTimeout(() => startSocket().catch(() => {}), delay);
			}
		});
	} catch (e) {
		writeStatus({ state: "ERROR", qr: "", error: String(e && e.message ? e.message : e) });
		sock = null;
	} finally {
		starting = false;
	}
}

function jidFromPhone(phone) {
	const digits = String(phone || "").replace(/\D/g, "");
	let n = digits;
	if (n.length === 10) n = "91" + n;
	if (n.startsWith("0") && n.length === 11) n = "91" + n.slice(1);
	return n + "@s.whatsapp.net";
}

async function sendText(phone, text) {
	if (!sock) throw new Error("WhatsApp is not connected.");
	const jid = jidFromPhone(phone);
	const r = await sock.sendMessage(jid, { text: String(text || "") });
	return { id: r && r.key && r.key.id };
}

async function sendDocument(phone, documentBase64, filename, caption, mimetype) {
	if (!sock) throw new Error("WhatsApp is not connected.");
	const jid = jidFromPhone(phone);
	const buffer = Buffer.from(String(documentBase64 || ""), "base64");
	if (!buffer.length) throw new Error("PDF file is empty.");
	const payload = {
		document: buffer,
		mimetype: mimetype || "application/pdf",
		fileName: filename || "invoice.pdf",
	};
	if (caption) payload.caption = String(caption).slice(0, 1024);
	const r = await sock.sendMessage(jid, payload);
	return { id: r && r.key && r.key.id };
}

// Baileys' `image` message key is what makes WhatsApp show an inline
// thumbnail in the chat instead of a document bubble that needs a tap to
// open — `sendDocument` above can never produce that no matter what
// mimetype is passed, since the message TYPE (not just the file's content
// type) is what WhatsApp renders differently (2026-08-19 direct request:
// bills sent over WhatsApp should be pictures, not a PDF attachment).
async function sendImage(phone, imageBase64, caption, mimetype) {
	if (!sock) throw new Error("WhatsApp is not connected.");
	const jid = jidFromPhone(phone);
	const buffer = Buffer.from(String(imageBase64 || ""), "base64");
	if (!buffer.length) throw new Error("Image file is empty.");
	const payload = {
		image: buffer,
		mimetype: mimetype || "image/png",
	};
	if (caption) payload.caption = String(caption).slice(0, 1024);
	const r = await sock.sendMessage(jid, payload);
	return { id: r && r.key && r.key.id };
}

function sendJson(res, code, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(code, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

function readBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch (e) {
				resolve({});
			}
		});
	});
}

const server = http.createServer(async (req, res) => {
	if (req.method === "GET" && req.url === "/status") {
		sendJson(res, 200, readStatus());
		return;
	}
	if (req.method === "POST" && req.url === "/start") {
		try {
			await startSocket();
			sendJson(res, 200, { ok: true, ...readStatus() });
		} catch (e) {
			writeStatus({ state: "ERROR", error: String(e.message || e) });
			sendJson(res, 500, { ok: false, error: String(e.message || e) });
		}
		return;
	}
	if (req.method === "POST" && req.url === "/logout") {
		try {
			if (sock) await sock.logout();
		} catch (e) {}
		sock = null;
		try {
			fs.rmSync(AUTH_DIR, { recursive: true, force: true });
			fs.mkdirSync(AUTH_DIR, { recursive: true });
		} catch (e) {}
		sendJson(res, 200, writeStatus({ state: "LOGGED_OUT", qr: "", phone: "", error: "" }));
		return;
	}
	if (req.method === "POST" && req.url === "/send") {
		const body = await readBody(req);
		try {
			const r = await sendText(body.phone, body.text);
			sendJson(res, 200, { ok: true, ...r });
		} catch (e) {
			sendJson(res, 500, { ok: false, error: String(e.message || e) });
		}
		return;
	}
	if (req.method === "POST" && req.url === "/send-document") {
		const body = await readBody(req);
		try {
			const r = await sendDocument(
				body.phone,
				body.document_base64,
				body.filename,
				body.caption,
				body.mimetype
			);
			sendJson(res, 200, { ok: true, ...r });
		} catch (e) {
			sendJson(res, 500, { ok: false, error: String(e.message || e) });
		}
		return;
	}
	if (req.method === "POST" && req.url === "/send-image") {
		const body = await readBody(req);
		try {
			const r = await sendImage(body.phone, body.image_base64, body.caption, body.mimetype);
			sendJson(res, 200, { ok: true, ...r });
		} catch (e) {
			sendJson(res, 500, { ok: false, error: String(e.message || e) });
		}
		return;
	}
	sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
	writeStatus({ state: "CONNECTING", qr: "", error: "" });
	startSocket().catch((e) => writeStatus({ state: "ERROR", qr: "", error: String(e.message || e) }));
});
