import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  getContentType,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import * as qrcode from "qrcode-terminal";
import OpenAI from "openai";
import pino from "pino";
import {
  MODE,
  DEV,
  getPersonaText,
  isGroupAllowed,
  isGroupJid,
  PENDING_NAME_TTL_MS,
  GREETING_PHRASES,
  TYPING_KEEPALIVE_MS,
  TYPING_SAFETY_STOP_MS,
} from "../config";
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
  migrateGroupTopicsToChatId,
} from "../memory/db";
import {
  blocksCarry,
  containsHardMarker,
  guessLabel,
  shouldCreateNewTopic,
} from "../conversation/topic";
import { MessageQueue } from "../utils/queue";
import { checkStockTool } from "../tools/inventory";
import { styleResponseTool } from "../tools/style";
import { handleCustomCommand, startPluginWatcher } from "../custom/loader";
import { logger } from "../utils/logger";

// state sementara untuk flow minta nama
const pendingName = new Map<string, { ts: number }>();
// one-shot migration guard for legacy group topic keys (senderId -> chatId)
const migratedGroupTopicKeys = new Set<string>();

export function sanitizeCandidate(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  // hindari kata ganti/umum yang bukan nama
  if (
    /(^|\s)(kamu|anda|situ|elo|lu|luh|bro|bang|bos|boss|sis|kak|mba|mbak|mas|siapa|panggil)($|\s)/.test(
      lower,
    )
  ) {
    return null;
  }
  return s;
}

export function extractName(text: string): string | null {
  const t = text.trim();
  const m1 = t.match(
    /\b(nama\s*saya|aku|saya|gue)\s+([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i,
  );
  if (m1) return sanitizeCandidate(m1[2]);
  const m2 = t.match(
    /\bpanggil\s+(?:aku|gue|saya)\s+([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i,
  );
  if (m2) return sanitizeCandidate(m2[1]);
  return null;
}

export function isAskOwnName(text: string): boolean {
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

export function extractRenameName(text: string): string | null {
  const t = text.trim();
  // pola eksplisit mengganti/panggilan
  const m1 = t.match(
    /\bpanggil\s+(?:aku|saya|gue)\s+([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i,
  );
  if (m1) return sanitizeCandidate(m1[1]);
  const m2 = t.match(
    /\b(?:ganti|ubah)\s+(?:nama|panggilan)(?:\s*(?:aku|saya|gue))?\s*(?:jadi|ke|menjadi)?\s*([A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,})\b/i,
  );
  if (m2) return sanitizeCandidate(m2[1]);
  return null;
}

export function isRenameIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  // jaga supaya pattern intent tetap eksplisit
  const hasPanggilSelf = /\bpanggil\s+(?:aku|saya|gue)\b/i.test(t);
  const hasGenericChange = /(ganti|ubah)\s+(nama|panggilan)/i.test(t);
  return hasPanggilSelf || hasGenericChange;
}

export function toTitleCase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function isGreetingOrSmallTalk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const hasQuestionMark = t.includes("?");
  if (hasQuestionMark) return false;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return false;
  return GREETING_PHRASES.some((p) => t === p || t.startsWith(p + " "));
}

export function extractEchoGreeting(text: string): string | null {
  const t = text.trim().toLowerCase();
  const tokens = t.split(/\s+/).filter(Boolean);
  const list = new Set([
    "halo",
    "hallo",
    "hai",
    "hi",
    "pagi",
    "siang",
    "sore",
    "malam",
  ]);
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

// Human-like typing simulation
async function simulateTyping(sock: WASocket, jid: string, textLength: number) {
  // Kecepatan ketik rata-rata manusia: ~5-8 karakter per detik (termasuk mikir)
  // Pesan pendek (<50 char) -> min 2 detik
  // Pesan panjang -> proporsional
  const typingSpeed = 6; // chars per second
  const minDuration = 2000;
  const idealDuration = Math.max(
    minDuration,
    (textLength / typingSpeed) * 1000,
  );

  // Cap maksimal agar tidak terlalu lama nunggu (misal max 15 detik untuk pesan super panjang)
  const finalDuration = Math.min(idealDuration, 15000);

  // Jika durasi panjang (> 5 detik), selipkan "pause" sebentar di tengah
  if (finalDuration > 5000) {
    await sock.sendPresenceUpdate("composing", jid);
    await new Promise((r) => setTimeout(r, 3000));

    await sock.sendPresenceUpdate("paused", jid); // Mikir bentar
    await new Promise((r) => setTimeout(r, 1500));

    await sock.sendPresenceUpdate("composing", jid); // Lanjut ngetik
    await new Promise((r) => setTimeout(r, finalDuration - 4500));
  } else {
    await sock.sendPresenceUpdate("composing", jid);
    await new Promise((r) => setTimeout(r, finalDuration));
  }

  await sock.sendPresenceUpdate("paused", jid);
}

export async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    browser: Browsers.macOS("AmberBot"),
    auth: state,
    logger: pino({ level: process.env.WA_LOG_LEVEL || "warn" }),
  });

  // Global sequential queue for message processing
  const msgQueue = new MessageQueue(1500);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      logger.info("[wa]", "QR code diterima. Silakan scan di aplikasi WhatsApp:");
      try {
        qrcode.generate(qr, { small: true });
      } catch (e) {
        logger.warn("[wa]", "Gagal merender QR di terminal. Gunakan string ini:", qr);
      }
    }
    if (connection === "close") {
      const code =
        (lastDisconnect?.error as any)?.output?.statusCode ||
        (lastDisconnect as any)?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn("[wa]", `connection closed, reconnect=${shouldReconnect}`);
      if (shouldReconnect) startWA();
    } else if (connection === "open") {
      logger.info("[wa]", "✅ WhatsApp connected");
      startPluginWatcher();
    }
  });

  const handleMessage = async (m: WAMessage) => {
    try {
      if (!m.message || m.key.fromMe) return;
      if (m.key.remoteJid?.includes("status@broadcast")) return;

      const content = m.message;
      const msgType = getContentType(content);
      if (!msgType) return;
      if (!(msgType === "conversation" || msgType === "extendedTextMessage"))
        return;

      // Mark read immediately (Blue tick)
      if (!isSeen(m.key.id!)) {
        await sock.readMessages([m.key]);
        markSeen(m.key.id!);
      }

      const jid = m.key.remoteJid!;
      const isGroup = isGroupJid(jid);

      if (MODE === "personal_only" && isGroup) return;
      if (MODE === "group_only" && !isGroup) return;

      if (isGroup && !isGroupAllowed(jid)) {
        return;
      }

      // Identifikasi Chat Room (Topic ID) vs Sender (User Identity)
      const chatId = jid.split("@")[0]; // ID Percakapan (Room)
      const senderJid = isGroup ? (m.key.participant || m.participant || jid) : jid;
      const senderId = senderJid ? senderJid.split("@")[0] : chatId; // ID Pengirim (Person)

      const text = extractMessageText(m.message).trim();
      if (!text) return;

      const handled = await handleCustomCommand({
        sock,
        msg: m,
        text,
        jid,
        sender: senderId,
        isGroup,
      });
      if (handled) return;

      // Upsert User Data (Sender)
      insertUser.run(senderId);

      // Gate: Minta nama hanya jika PRIVATE CHAT
      // Di grup, kita pakai fallback pushname/participant ID agar tidak spamming
      const userRow = getUser(senderId) as any;
      const nameEmpty = !userRow?.name || (userRow.name || "").trim() === "";
      const nickEmpty = !userRow?.nickname || (userRow.nickname || "").trim() === "";
      const noIdentity = nameEmpty && nickEmpty;

      if (!isGroup && noIdentity) {
        // bersihkan entry kadaluarsa
        const nowTs = Date.now();
        const existing = pendingName.get(senderId);
        if (existing && nowTs - existing.ts > PENDING_NAME_TTL_MS) {
          pendingName.delete(senderId);
        }

        // hanya pancing tanya nama saat sapaan/obrolan ringan pendek
        if (!pendingName.has(senderId) && isGreetingOrSmallTalk(text)) {
          pendingName.set(senderId, { ts: Date.now() });
          const greet = extractEchoGreeting(text) || "Hai";
          const oneShot = `${greet}! Aku Amber, asistennya Nata. Siap bantu kamu. Biar enak nyapa, kenalan dikit ya. Panggilan kamu siapa? Misal: "aku Rara" atau "panggil aku Rara".`;
          await sock.sendMessage(jid, { text: oneShot });
          return;
        }
        const picked = extractName(text);
        if (picked) {
          // simpan sebagai name dan nickname default
          const tc = toTitleCase(picked);
          setUserProfile(senderId, tc ?? null, tc ?? null);
          pendingName.delete(senderId);
          await sock.sendMessage(jid, {
            text: `Sip! Mulai sekarang aku panggil kamu ${tc}. Ada yang bisa kubantu sekarang?`,
          });
          return;
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
          setUserProfile(senderId, tc ?? null, tc ?? null);
          pendingName.delete(senderId);
          await sock.sendMessage(jid, {
            text: `Oke, mulai sekarang aku panggil kamu ${tc}. Ada yang bisa kubantu sekarang?`,
          });
          return;
        }
        if (isRenameIntent(text)) {
          await sock.sendMessage(jid, {
            text: `Boleh. Nama panggilan barunya mau jadi siapa?`,
          });
          return;
        }
        // jika user belum jawab dengan pola nama, dan kita tidak sedang dalam sesi pending, jangan pancing ulang
        if (pendingName.has(senderId)) {
          await sock.sendMessage(jid, {
            text: `Panggilan kamu siapa ya? Misal: "aku Ara".`,
          });
          return;
        }
        return;
      }

      // Resolve Speaker Name for LLM Context
      let speakerName = "User";
      if (userRow?.nickname) speakerName = userRow.nickname;
      else if (userRow?.name) speakerName = userRow.name;
      else if (m.pushName) speakerName = m.pushName; // Fallback to WA Pushname

      // Gunakan chatId (Room) untuk topic, bukan senderId
      let latest = selectLatestTopic.get(chatId) as any;

      // Startup/upgrade migration: legacy group topics keyed by senderId -> chatId.
      // Run once per sender+room key and only when room has no topic yet.
      if (isGroup && !latest) {
        const migrationKey = `${senderId}->${chatId}`;
        if (!migratedGroupTopicKeys.has(migrationKey)) {
          const moved = migrateGroupTopicsToChatId(senderId, chatId);
          migratedGroupTopicKeys.add(migrationKey);
          if (moved) {
            latest = selectLatestTopic.get(chatId) as any;
            logger.info("[migration]", `Re-keyed legacy topics ${migrationKey}`);
          }
        }
      }

      const ctxBefore = fetchContext(chatId);
      const newTopic = shouldCreateNewTopic(latest, text);
      let topic = latest;
      if (newTopic) {
        const id = newTopicId(chatId);
        const label = guessLabel(text);
        topic = {
          topic_id: id,
          user_id: chatId, // Topic attached to Room
          created_at: now(),
          last_active: now(),
          label,
        };
        insertTopic.run(
          topic.topic_id,
          chatId,
          topic.created_at,
          topic.last_active,
          label,
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

      const profile = getUser(senderId);
      const name = profile?.name?.trim();
      const nick = profile?.nickname?.trim();
      
      // Inject User Context: "You are talking to [Name]"
      // Untuk grup, kita tidak inject profil spesifik di System Prompt karena campur aduk.
      // Profil akan dihandle via prefix [Name]: di user message.
      const userSnippet = (!isGroup && (name || nick))
          ? `\n\n[user]\nname: ${name || ""}\nnickname: ${nick || ""}`
          : "";

      // Logic "Tanya Nama Sendiri"
      if (isAskOwnName(text)) {
        const known = nick || name || m.pushName;
        if (known) {
          await sock.sendMessage(jid, { text: `Namamu ${known}.` });
        } else {
           // Di grup kalau belum kenal, jawab sopan saja
           await sock.sendMessage(jid, { text: `Aku belum tahu namamu.` });
        }
        return;
      }

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
        setUserProfile(senderId, tc, tc);
        await sock.sendMessage(jid, {
          text: `Oke, mulai sekarang aku panggil kamu ${tc}.`,
        });
        return;
      }

      const recentTurns = ctx.latest
        ? fetchRecentTurns(ctx.latest.topic_id, 3)
        : [];

      const historyMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        recentTurns.map(
          (t): OpenAI.Chat.Completions.ChatCompletionMessageParam =>
            t.role === "user"
              ? { role: "user", content: t.text }
              : { role: "assistant", content: t.text },
        );
      
      const contentForLLM = isGroup ? `[${speakerName}]: ${text}` : text;

      const messagesForLLM: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [
          {
            role: "system",
            content: persona + userSnippet + policySnippet + summariesSnippet,
          },
          ...historyMsgs,
          { role: "user", content: contentForLLM },
        ];


      let typingInterval: NodeJS.Timeout | undefined;
      let typingStopTimeout: NodeJS.Timeout | undefined;

      // Jeda "Membaca" (Reading delay) sebelum mulai mengetik
      // Simulasi manusia membaca pesan masuk: 1-2 detik
      await new Promise((r) => setTimeout(r, 1500));

      try {
        const sendTyping = () => {
          void sock.sendPresenceUpdate("composing", jid);
        };
        // send immediately and keep-alive every 5s while waiting LLM
        sendTyping();
        typingInterval = setInterval(sendTyping, TYPING_KEEPALIVE_MS);
        // safety stop after 60s to avoid dangling typing
        typingStopTimeout = setTimeout(() => {
          if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = undefined;
          }
          void sock.sendPresenceUpdate("paused", jid);
        }, TYPING_SAFETY_STOP_MS);
      } catch {}

      // Pass available tools (checkStockTool) to the LLM
      const tools = [checkStockTool, styleResponseTool];
      const replyResult = await chatLLM(messagesForLLM, tools);
      
      const reply = replyResult.text;
      const shouldQuote = replyResult.mode === "quote";

      const exchange = `USER: ${text}\nBOT: ${reply}`;
      const sum = await summarizeForMemory(exchange);
      addSummary(topic.topic_id, sum);
      addTurn(topic.topic_id, "user", text);
      addTurn(topic.topic_id, "assistant", reply);
      insertTopic.run(
        topic.topic_id,
        chatId,
        topic.created_at,
        now(),
        topic.label,
      );

      // Stop previous intervals if any
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = undefined;
      }
      if (typingStopTimeout) {
        clearTimeout(typingStopTimeout);
        typingStopTimeout = undefined;
      }

      // Simulate human typing based on reply length
      await simulateTyping(sock, jid, reply.length);

      await sock.sendMessage(jid, { 
        text: reply,
        contextInfo: shouldQuote ? {
          stanzaId: m.key.id,
          participant: m.key.participant || m.key.remoteJid,
          quotedMessage: m.message
        } : undefined
      }, { quoted: shouldQuote ? m : undefined });
      if (logger.isLevelEnabled("debug")) {
        const approxTokens = Math.round(
          messagesForLLM
            .map((m) => (typeof m.content === "string" ? m.content.length : 0))
            .reduce((a, b) => a + b, 0) / 4,
        );
        logger.debug(
          "[ctx]",
          `tokens~=${approxTokens}, summaries=${summariesToSend.length}, recentTurns=${recentTurns.length}, newTopic=${newTopic}`,
        );
      }
    } catch (err) {
      logger.error("[wa]", "handle message error", err);
    }
  };

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      // Use queue to process messages sequentially with delay
      msgQueue.enqueue(() => handleMessage(m));
    }
  });
}

function extractMessageText(msg: any): string {
  const inner =
    msg?.ephemeralMessage?.message ||
    msg?.viewOnceMessageV2?.message ||
    msg?.viewOnceMessage?.message ||
    msg;
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
