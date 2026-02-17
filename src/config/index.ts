export const MODEL_ID =
  process.env.MODEL_ID || "meta-llama/Meta-Llama-3.1-8B-Instruct";

export const SYSTEM_PROMPT = `Kamu adalah Amber, asisten milik Nata. Gaya santai, bantu user dengan jawaban ringkas, praktis, dan sopan. Jawab sebisa mungkin. Jika informasi terbatas, jelaskan asumsi singkat dan lanjutkan, jangan menolak kecuali menyangkut hal terlarang. Hindari salam pembuka berulang. Jika pertanyaan menyangkut harga, pembayaran, rekening, atau transfer, gunakan policy khusus bila tersedia di [policy].`;

export const MAX_SUMMARIES_PER_TOPIC = 10;
export const TOPIC_INACTIVITY_MS = 10 * 1000;

export const DEV =
  process.env.NODE_ENV !== "production" && process.env.DEV !== "false";

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

export const MODE = (process.env.MODE || "all").toLowerCase();

const GROUPS_FILE_PATH = path.resolve(process.cwd(), "groups.txt");
let groupWhitelistCache: string[] = [];
let groupWhitelistMtime = 0;

function parseGroupWhitelistText(text: string): string[] {
  const value = text.trim();
  if (!value) return [];

  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        return arr
          .map((s) => (typeof s === "string" ? s : ""))
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
    } catch {}
  }

  return value
    .split(/[\n,;]+/)
    .map((s) =>
      s
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .split("#")[0]
        .trim(),
    )
    .filter(Boolean);
}

function parseGroupWhitelistEnv(raw: string | undefined): string[] {
  const value = (raw || "").trim();
  if (!value) return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        return arr
          .map((s) => (typeof s === "string" ? s : ""))
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
    } catch {}
  }
  return value
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function loadGroupWhitelist(): string[] {
  try {
    const stat = fs.statSync(GROUPS_FILE_PATH);
    if (stat.mtimeMs !== groupWhitelistMtime) {
      const text = fs.readFileSync(GROUPS_FILE_PATH, "utf8");
      groupWhitelistCache = parseGroupWhitelistText(text);
      groupWhitelistMtime = stat.mtimeMs;
    }
  } catch {
    if (groupWhitelistCache.length === 0) {
      groupWhitelistCache = parseGroupWhitelistEnv(process.env.GROUP_WHITELIST);
    }
  }
  return groupWhitelistCache;
}

export function getGroupWhitelist(): string[] {
  return loadGroupWhitelist();
}

export const GROUP_WHITELIST: string[] = [];

export function isGroupJid(jid: string): boolean {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

export function isGroupAllowed(jid: string): boolean {
  if (!isGroupJid(jid)) return true;
  const list = getGroupWhitelist();
  if (list.length === 0) return false;
  const bare = jid.split("@")[0];
  return list.includes(jid) || list.includes(bare);
}

// TTL untuk flow minta nama panggilan
export const PENDING_NAME_TTL_MS =
  Number.parseInt(process.env.PENDING_NAME_TTL_MS || "", 10) || 5 * 60 * 1000;

// Pengaturan presence typing
export const TYPING_KEEPALIVE_MS =
  Number.parseInt(process.env.TYPING_KEEPALIVE_MS || "", 10) || 5000;
export const TYPING_SAFETY_STOP_MS =
  Number.parseInt(process.env.TYPING_SAFETY_STOP_MS || "", 10) || 60000;

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
  "selamat pagi",
  "selamat siang",
  "selamat sore",
  "selamat malam",
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
