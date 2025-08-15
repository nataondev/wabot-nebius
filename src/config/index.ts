export const MODEL_ID =
  process.env.MODEL_ID || "meta-llama/Meta-Llama-3.1-8B-Instruct";

export const SYSTEM_PROMPT = `Kamu adalah Amber, asisten milik Nata. Gaya santai, bantu user dengan jawaban ringkas, praktis, dan sopan. Jawab sebisa mungkin. Jika informasi terbatas, jelaskan asumsi singkat dan lanjutkan, jangan menolak kecuali menyangkut hal terlarang. Hindari salam pembuka berulang. Jika pertanyaan menyangkut harga, pembayaran, rekening, atau transfer, gunakan policy khusus bila tersedia di [policy].`;

export const MAX_SUMMARIES_PER_TOPIC = 3;
export const TOPIC_INACTIVITY_MS = 10 * 1000;

export const DEV = process.env.NODE_ENV !== "production" && process.env.DEV !== "false";

// Persona loader (hot-reload)
import * as fs from "fs";
import * as path from "path";

const PERSONA_FILE_PATH = path.resolve(__dirname, "persona.md");
let personaCacheText = "";
let personaCacheMtime = 0;

function loadPersonaFromDisk(): string {
  try {
    const stat = fs.statSync(PERSONA_FILE_PATH);
    if (stat.mtimeMs !== personaCacheMtime || !personaCacheText) {
      personaCacheText = fs.readFileSync(PERSONA_FILE_PATH, "utf8");
      personaCacheMtime = stat.mtimeMs;
    }
    return personaCacheText;
  } catch {
    return SYSTEM_PROMPT;
  }
}

export function getPersonaText(): string {
  return loadPersonaFromDisk();
}

// ===== WhatsApp & runtime config =====

// Grup yang diperbolehkan (whitelist). Bisa berupa full JID ("xxxx-xxxx@g.us")
// atau bare id sebelum "@" ("xxxx-xxxx").
// Format env didukung:
// - CSV: "id1@g.us,id2"
// - Baris-baru / titik-koma: "id1@g.us\nid2" atau "id1;id2"
// - JSON array: '["id1@g.us","id2"]'
function parseGroupWhitelistEnv(raw: string | undefined): string[] {
  const value = (raw || "").trim();
  if (!value) return [];
  // Coba JSON array terlebih dahulu bila terlihat seperti JSON
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        return arr
          .map((s) => (typeof s === "string" ? s : ""))
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
    } catch {
      // fallback ke pemisah non-JSON di bawah
    }
  }
  // Split berdasarkan koma, baris-baru, atau titik-koma
  return value
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export const GROUP_WHITELIST: string[] = parseGroupWhitelistEnv(process.env.GROUP_WHITELIST);

export function isGroupJid(jid: string): boolean {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

export function isGroupAllowed(jid: string): boolean {
  if (!isGroupJid(jid)) return true; // bukan grup => boleh
  if (GROUP_WHITELIST.length === 0) return false; // default to deny all groups
  const bare = jid.split("@")[0];
  return GROUP_WHITELIST.includes(jid) || GROUP_WHITELIST.includes(bare);
}

// TTL untuk flow minta nama panggilan
export const PENDING_NAME_TTL_MS = Number.parseInt(process.env.PENDING_NAME_TTL_MS || "", 10) || 5 * 60 * 1000;

// Pengaturan presence typing
export const TYPING_KEEPALIVE_MS = Number.parseInt(process.env.TYPING_KEEPALIVE_MS || "", 10) || 5000;
export const TYPING_SAFETY_STOP_MS = Number.parseInt(process.env.TYPING_SAFETY_STOP_MS || "", 10) || 60000;

// Frasa sapaan/obrolan ringan untuk memancing pengenalan nama
export const GREETING_PHRASES: string[] = [
  "nata",
  "halo",
  "hai",
  "hi",
  "pagi",
  "siang",
  "sore",
  "malam",
  "iya",
  "oke",
  "ok",
  "makasih",
  "terima kasih",
  "thanks",
  "test",
  "tes",
  "kak",
];


