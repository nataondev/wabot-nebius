import OpenAI from "openai";
import { MODEL_ID } from "../config";

export const openai = new OpenAI({
  apiKey: process.env.NEBIUS_API_KEY,
  baseURL: "https://api.studio.nebius.ai/v1/",
});

export async function chatLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError: any = null;
  while (attempt < maxAttempts) {
    try {
      const timeoutMs = 20000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "AbortError" })), timeoutMs)
      );
      const res: any = await Promise.race([
        openai.chat.completions.create({
          model: MODEL_ID,
          messages,
          temperature: 0.6,
        }),
        timeoutPromise,
      ]);
      return res.choices?.[0]?.message?.content?.trim() ?? "(maaf, lagi blank)";
    } catch (err: any) {
      lastError = err;
      const retriable = err?.status >= 500 || err?.name === "AbortError";
      if (!retriable) break;
      const backoffMs = 300 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    attempt++;
  }
  return "(maaf, terjadi gangguan sementara)";
}

export async function summarizeForMemory(history: string): Promise<string> {
  const prompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "Ringkas percakapan jadi 1–3 kalimat. Simpan ANGKA/WAKTU/NAMA secara presisi. Fokus fakta, preferensi, keputusan, intent. Tanpa opini/emoji.",
    },
    { role: "user", content: history },
  ];
  try {
    const out = await chatLLM(prompt);
    return out;
  } catch {
    return (history || "").slice(0, 200) + " … (ringkas sementara)";
  }
}

/**
 * Ekstraksi nama panggilan menggunakan LLM.
 * - Masukan: kalimat user yang memuat intent mengganti nama panggilan
 * - Keluaran: hanya nama panggilan baru (tanpa kata lain) atau null jika tidak yakin
 */
export async function extractNicknameLLM(userText: string): Promise<string | null> {
  const system =
    "Kamu menerima satu pesan bahasa Indonesia. Tugasmu: jika pesan meminta mengganti nama panggilan, ekstrak hanya NAMA barunya. Balas hanya dengan nama, tanpa kata lain, tanpa tanda baca. Jika tidak yakin nama barunya, balas kosong.";
  const examples = [
    ["tolong ganti nama panggilan aku menjadi stefi", "Stefi"],
    ["panggil aku rara ya", "Rara"],
    ["bisa gak ganti nama panggilan?", ""],
    ["ubah nama saya ke muhammad faris", "Muhammad Faris"],
  ] as const;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  messages.push({ role: "system", content: system });
  for (const [u, a] of examples) {
    messages.push({ role: "user", content: u });
    messages.push({ role: "assistant", content: a });
  }
  messages.push({ role: "user", content: userText });

  // gunakan pola retry mirip chatLLM, namun temperatur rendah
  const maxAttempts = 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      const timeoutMs = 15000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "AbortError" })), timeoutMs)
      );
      const res: any = await Promise.race([
        openai.chat.completions.create({ model: MODEL_ID, messages, temperature: 0.2 }),
        timeoutPromise,
      ]);
      const raw = (res.choices?.[0]?.message?.content ?? "").trim();
      const cleaned = raw.replace(/["'`]/g, "").trim();
      // ambil hanya huruf/koma titik penamaan umum, maksimal 4 kata
      const m = cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,}){0,3}/);
      const picked = (m ? m[0] : "").trim();
      if (!picked) return null;
      if (picked.length < 2 || picked.length > 60) return null;
      return picked
        .split(/\s+/)
        .filter(Boolean)
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    } catch (err: any) {
      const retriable = err?.status >= 500 || err?.name === "AbortError";
      if (!retriable) break;
      const backoffMs = 200 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    attempt++;
  }
  return null;
}


