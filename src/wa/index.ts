import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  getContentType,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import * as qrcode from "qrcode-terminal";
import OpenAI from "openai";
import { DEV, getPersonaText, isGroupAllowed, isGroupJid, PENDING_NAME_TTL_MS, GREETING_PHRASES, TYPING_KEEPALIVE_MS, TYPING_SAFETY_STOP_MS, GROUP_WHITELIST } from "../config";
import { chatLLM, summarizeForMemory, extractNicknameLLM } from "../llm/client";
import {
  addSummary,
  addTurn,
  fetchContext,
  fetchRecentTurns,
  insertTopic,
  insertUser,
  isSeen,
  markSeen,
  getUser,
  setUserProfile,
  setIntroAsked,
  newTopicId,
  now,
  selectLatestTopic,
} from "../memory/db";
import { blocksCarry, containsHardMarker, guessLabel, shouldCreateNewTopic } from "../conversation/topic";

// state sementara untuk flow minta nama
const pendingName = new Map<string, { ts: number }>();

function sanitizeCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  // hindari kata ganti/umum yang bukan nama
  if (/(^|\s)(kamu|anda|situ|elo|lu|luh|bro|bang|bos|boss|sis|kak|mba|mbak|mas|siapa|panggil)($|\s)/.test(lower)) {
    return null;
  }
  return s;
}

function extractName(text: string): string | null {
  const t = text.trim();
  const m1 = t.match(/\b(nama\s*saya|aku|saya|gue)\s+([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i);
  if (m1) return sanitizeCandidate(m1[2]);
  const m2 = t.match(/\bpanggil\s+(?:aku|gue|saya)\s+([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i);
  if (m2) return sanitizeCandidate(m2[1]);
  return null;
}

function isAskOwnName(text: string): boolean {
  const t = text.trim().toLowerCase();
  // hapus tanda baca kecuali tanda tanya untuk analisis ringan
  const keep = t.replace(/[.,!]/g, "");
  const tokens = keep.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return false; // batasi ke pertanyaan pendek saja
  const joined = tokens.join(" ");
  const hasQuestionCue = /\?|\b(siapa|siapakah|apakah|apa)\b/.test(joined);
  if (!hasQuestionCue) return false;
  const strongPatterns = [
    /^(namaku|nama\s*(aku|saya|gue))\s*(siapa|siapakah)\??$/,
    /^(siapa|siapakah)\s+nama\s*(aku|saya|gue)\??$/,
    /^apa\s+nama\s*(aku|saya|gue)\??$/,
    /^(namaku|nama\s*(aku|saya|gue))\?$/,
  ];
  return strongPatterns.some((rx) => rx.test(joined));
}

function extractRenameName(text: string): string | null {
  const t = text.trim();
  // pola eksplisit mengganti/panggilan
  const m1 = t.match(/\bpanggil\s+(?:aku|saya|gue)\s+([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i);
  if (m1) return sanitizeCandidate(m1[1]);
  const m2 = t.match(/\b(?:ganti|ubah)\s+(?:nama|panggilan)(?:\s*(?:aku|saya|gue))?\s*(?:jadi|ke|menjadi)?\s*([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i);
  if (m2) return sanitizeCandidate(m2[1]);
  return null;
}

function isRenameIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  // jaga supaya pattern intent tetap eksplisit
  const hasPanggilSelf = /\bpanggil\s+(?:aku|saya|gue)\b/i.test(t);
  const hasGenericChange = /(ganti|ubah)\s+(nama|panggilan)/i.test(t);
  return hasPanggilSelf || hasGenericChange;
}

function toTitleCase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isGreetingOrSmallTalk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const hasQuestionMark = t.includes("?");
  if (hasQuestionMark) return false;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return false;
  return GREETING_PHRASES.some((p) => t === p || t.startsWith(p + " "));
}

function extractEchoGreeting(text: string): string | null {
  const t = text.trim().toLowerCase();
  const tokens = t.split(/\s+/).filter(Boolean);
  const list = new Set(["halo", "hallo", "hai", "hi", "pagi", "siang", "sore", "malam"]);
  for (const tok of tokens) {
    if (list.has(tok)) {
      const w = tok.charAt(0).toUpperCase() + tok.slice(1);
      // normalisasi "hi" -> "Hai"
      if (tok === "hi") return "Hai";
      if (tok === "hallo") return "Halo";
      return w;
    }
  }
  return null;
}

export async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    browser: Browsers.macOS("AmberBot"),
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("QR code diterima. Silakan scan di aplikasi WhatsApp:");
      try {
        qrcode.generate(qr, { small: true });
      } catch (e) {
        console.log("Gagal merender QR di terminal. Gunakan string ini:", qr);
      }
    }
    if (connection === "close") {
      const code =
        (lastDisconnect?.error as any)?.output?.statusCode ||
        (lastDisconnect as any)?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("connection closed, reconnect=", shouldReconnect);
      if (shouldReconnect) startWA();
    } else if (connection === "open") {
      console.log("✅ WhatsApp connected");
      if (DEV) {
        // Cetak daftar grup dan whitelist saat startup untuk memudahkan konfigurasi
        console.log(`DEV: GROUP_WHITELIST=`, GROUP_WHITELIST);
        (async () => {
          try {
            const groups = await sock.groupFetchAllParticipating();
            const entries = Object.values(groups || {});
            console.log(`DEV: Ditemukan ${entries.length} grup:`);
            for (const g of entries as any[]) {
              const allowed = isGroupAllowed(g.id) ? "allowed" : "denied";
              console.log(`- ${g.subject} :: ${g.id} [${allowed}]`);
            }
          } catch (e) {
            console.log("DEV: gagal mengambil daftar grup", e);
          }
        })();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      try {
        if (!m.message || m.key.fromMe) continue;
        if (m.key.remoteJid?.includes("status@broadcast")) continue;
        if (type !== "notify") continue;
        const content = m.message;
        const msgType = getContentType(content);
        if (!msgType) continue;
        if (!(msgType === "conversation" || msgType === "extendedTextMessage")) continue;

        if (isSeen(m.key.id!)) continue;
        markSeen(m.key.id!);

        const jid = m.key.remoteJid!;
        // Tolak grup yang tidak di-whitelist
        if (isGroupJid(jid) && !isGroupAllowed(jid)) {
          continue;
        }

        const userId = jid.split("@")[0];
        const text = extractMessageText(m.message).trim();
        if (!text) continue;

        insertUser.run(userId);

        // Gate: minta nama panggilan sebelum panggil LLM bila name & nickname kosong
        const userRow = getUser(userId) as any;
        const nameEmpty = !userRow?.name || (userRow.name || "").trim() === "";
        const nickEmpty = !userRow?.nickname || (userRow.nickname || "").trim() === "";
        const noIdentity = nameEmpty && nickEmpty;
        if (noIdentity) {
          // bersihkan entry kadaluarsa
          const nowTs = Date.now();
          const existing = pendingName.get(userId);
          if (existing && nowTs - existing.ts > PENDING_NAME_TTL_MS) {
            pendingName.delete(userId);
          }

          // hanya pancing tanya nama saat sapaan/obrolan ringan pendek
          if (!pendingName.has(userId) && isGreetingOrSmallTalk(text)) {
            pendingName.set(userId, { ts: Date.now() });
            const greet = extractEchoGreeting(text) || "Hai";
            const oneShot = `${greet}! Aku Amber, asistennya Nata. Siap bantu kamu. Biar enak nyapa, kenalan dikit ya. Panggilan kamu siapa? Misal: "aku Rara" atau "panggil aku Rara".`;
            await sock.sendMessage(jid, { text: oneShot });
            continue;
          }
          const picked = extractName(text);
          if (picked) {
            // simpan sebagai name dan nickname default
            const tc = toTitleCase(picked);
            setUserProfile(userId, tc ?? null, tc ?? null);
            pendingName.delete(userId);
            await sock.sendMessage(jid, { text: `Sip! Mulai sekarang aku panggil kamu ${tc}. Ada yang bisa kubantu sekarang?` });
            continue;
          }
          // Coba tangkap pola "ganti/ubah nama" termasuk via LLM
          let renameTry = extractRenameName(text);
          if (!renameTry && isRenameIntent(text)) {
            try {
              const guess = await extractNicknameLLM(text);
              const sanitized = sanitizeCandidate(guess);
              if (sanitized) renameTry = sanitized;
            } catch {}
          }
          if (renameTry && isRenameIntent(text)) {
            const tc = toTitleCase(renameTry);
            setUserProfile(userId, tc ?? null, tc ?? null);
            pendingName.delete(userId);
            await sock.sendMessage(jid, { text: `Oke, mulai sekarang aku panggil kamu ${tc}. Ada yang bisa kubantu sekarang?` });
            continue;
          }
          if (isRenameIntent(text)) {
            await sock.sendMessage(jid, { text: `Boleh. Nama panggilan barunya mau jadi siapa?` });
            continue;
          }
          // jika user belum jawab dengan pola nama, dan kita tidak sedang dalam sesi pending, jangan pancing ulang
          if (pendingName.has(userId)) {
            await sock.sendMessage(jid, { text: `Panggilan kamu siapa ya? Misal: "aku Ara".` });
            continue;
          }
          continue;
        }
        const latest = selectLatestTopic.get(userId) as any;
        const ctxBefore = fetchContext(userId);
        const newTopic = shouldCreateNewTopic(latest, text);
        let topic = latest;
        if (newTopic) {
          const id = newTopicId(userId);
          const label = guessLabel(text);
          topic = {
            topic_id: id,
            user_id: userId,
            created_at: now(),
            last_active: now(),
            label,
          };
          insertTopic.run(
            topic.topic_id,
            userId,
            topic.created_at,
            topic.last_active,
            label
          );
        }

        const ctx = ctxBefore;
        const policySnippet = ctx.systemPolicy
          ? `\n\n[policy]\n${JSON.stringify(ctx.systemPolicy)}`
          : "";
        let summariesToSend: string[] = [];
        if (newTopic) {
          const allowCarry = !blocksCarry(text);
          summariesToSend = allowCarry ? ctx.summaries.slice(-2) : [];
        } else {
          summariesToSend = ctx.summaries.slice(-5);
        }
        const summariesSnippet = summariesToSend.length
          ? `\n\n[rangkuman-topik]\n- ${summariesToSend.join("\n- ")}`
          : "";

        const persona = getPersonaText();

        const profile = getUser(userId);
        const name = profile?.name?.trim();
        const nick = profile?.nickname?.trim();
        const userSnippet = name || nick ? `\n\n[user]\nname: ${name || ""}\nnickname: ${nick || ""}` : "";

        // Jika user menanyakan namanya sendiri, jawab langsung dari profil tanpa panggil LLM
        if (isAskOwnName(text)) {
          const known = nick || name;
          if (known) {
            await sock.sendMessage(jid, { text: `Namamu ${known}.` });
          } else {
            await sock.sendMessage(jid, { text: `Aku belum menyimpan namamu. Boleh sebut nama panggilan kamu?` });
          }
          continue;
        }

        // Deteksi permintaan ubah nama panggilan.
        // Tetap pertahankan pola intent, namun gunakan LLM sebagai fallback untuk ekstraksi nama.
        let renamePicked = extractRenameName(text);
        if (!renamePicked && isRenameIntent(text)) {
          try {
            const llmName = await extractNicknameLLM(text);
            const sanitized = sanitizeCandidate(llmName);
            if (sanitized) renamePicked = sanitized;
          } catch {}
        }
        if (renamePicked && isRenameIntent(text)) {
          const tc = toTitleCase(renamePicked);
          setUserProfile(userId, tc, tc);
          await sock.sendMessage(jid, { text: `Oke, mulai sekarang aku panggil kamu ${tc}. Ada yang bisa kubantu sekarang?` });
          continue;
        }

        const recentTurns = ctx.latest
          ? fetchRecentTurns(ctx.latest.topic_id, 3)
          : [];

        const historyMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = recentTurns.map(
          (t): OpenAI.Chat.Completions.ChatCompletionMessageParam =>
            t.role === "user"
              ? { role: "user", content: t.text }
              : { role: "assistant", content: t.text }
        );

        const messagesForLLM: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          {
            role: "system",
            content: persona + userSnippet + policySnippet + summariesSnippet,
          },
          ...historyMsgs,
          { role: "user", content: text },
        ];

        let typingInterval: NodeJS.Timeout | undefined;
        let typingStopTimeout: NodeJS.Timeout | undefined;
        try {
          const sendTyping = () => { void sock.sendPresenceUpdate("composing", jid); };
          // send immediately and keep-alive every 5s while waiting LLM
          sendTyping();
          typingInterval = setInterval(sendTyping, TYPING_KEEPALIVE_MS);
          // safety stop after 60s to avoid dangling typing
          typingStopTimeout = setTimeout(() => {
            if (typingInterval) { clearInterval(typingInterval); typingInterval = undefined; }
            void sock.sendPresenceUpdate("paused", jid);
          }, TYPING_SAFETY_STOP_MS);
        } catch {}

        let reply = await chatLLM(messagesForLLM);

        // Intro flow dipindahkan ke gate sebelum panggil LLM

        const exchange = `USER: ${text}\nBOT: ${reply}`;
        const sum = await summarizeForMemory(exchange);
        addSummary(topic.topic_id, sum);
        addTurn(topic.topic_id, "user", text);
        addTurn(topic.topic_id, "assistant", reply);
        insertTopic.run(
          topic.topic_id,
          userId,
          topic.created_at,
          now(),
          topic.label
        );

        // ensure typing is cleared before sending
        try {
          if (typingInterval) { clearInterval(typingInterval); typingInterval = undefined; }
          if (typingStopTimeout) { clearTimeout(typingStopTimeout); typingStopTimeout = undefined; }
          await sock.sendPresenceUpdate("paused", jid);
        } catch {}
        await sock.sendMessage(jid, { text: reply });
        if (DEV) {
          const approxTokens = Math.round(
            messagesForLLM
              .map((m) => (typeof m.content === "string" ? m.content.length : 0))
              .reduce((a, b) => a + b, 0) / 4
          );
          console.log(
            `[ctx] tokens~=${approxTokens}, summaries=${summariesToSend.length}, recentTurns=${recentTurns.length}, newTopic=${newTopic}`
          );
        }
      } catch (err) {
        console.error("handle message error", err);
      }
    }
  });
}

function extractMessageText(msg: any): string {
  const inner = msg?.ephemeralMessage?.message || msg?.viewOnceMessageV2?.message || msg?.viewOnceMessage?.message || msg;
  const type = getContentType(inner);
  if (!type) return "";
  switch (type) {
    case "conversation":
      return inner.conversation || "";
    case "extendedTextMessage":
      return inner.extendedTextMessage?.text || "";
    case "imageMessage":
    case "videoMessage":
      return inner[type]?.caption || "";
    case "documentMessage":
      return inner.documentMessage?.caption || "";
    case "buttonsResponseMessage":
      return (
        inner.buttonsResponseMessage?.selectedButtonId ||
        inner.buttonsResponseMessage?.selectedDisplayText ||
        ""
      );
    case "listResponseMessage":
      return inner.listResponseMessage?.singleSelectReply?.selectedRowId || "";
    case "templateButtonReplyMessage":
      return inner.templateButtonReplyMessage?.selectedId || "";
    default:
      return "";
  }
}


