import OpenAI from "openai";
import { MODEL_ID } from "../config";
import { TOOL_IMPLEMENTATIONS } from "../tools/inventory";

// Flag to disable tools if model doesn't support them
let TOOLS_SUPPORTED = true;

export const openai = new OpenAI({
  apiKey: process.env.NEBIUS_API_KEY,
  baseURL: "https://api.studio.nebius.ai/v1/",
});

export async function chatLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [],
): Promise<{ text: string; mode?: "quote" | "general" }> {
  const maxAttempts = 3;
  let attempt = 0;
  let responseMode: "quote" | "general" = "general";

  // Clone messages to avoid mutating original array during tool loop
  let currentMessages = [...messages];

  while (attempt < maxAttempts) {
    try {
      const timeoutMs = 25000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(Object.assign(new Error("timeout"), { name: "AbortError" })),
          timeoutMs,
        ),
      );

      // Only pass tools if they are supported and provided
      const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
        {
          model: MODEL_ID,
          messages: currentMessages,
          temperature: 0.6,
        };

      if (tools.length > 0 && TOOLS_SUPPORTED) {
        requestOptions.tools = tools;
      }

      const res: any = await Promise.race([
        openai.chat.completions.create(requestOptions),
        timeoutPromise,
      ]);

      const msg = res.choices?.[0]?.message;

      // Handle Tool Calls (Recursively)
      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        // Add assistant's tool call message to history
        currentMessages.push(msg);

        for (const toolCall of msg.tool_calls) {
          const fnName = toolCall.function.name;
          const fnArgs = JSON.parse(toolCall.function.arguments || "{}");

          if (fnName === "style_response") {
            if (fnArgs.mode === "quote") responseMode = "quote";
            if (fnArgs.mode === "general") responseMode = "general";
            
            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, mode: responseMode }),
            });
            continue;
          }

          let toolResult = JSON.stringify({ error: "Tool not found" });

          // Execute tool if it exists
          if (TOOL_IMPLEMENTATIONS[fnName]) {
            try {
              // Assuming all tools accept a single object or specific args
              // For simplicity, we pass the first argument value if it's a single param function
              // But standard is passing object. Our mock is (itemName) -> checkStock(itemName)
              // Let's adjust based on schema.
              toolResult = TOOL_IMPLEMENTATIONS[fnName](fnArgs.itemName);
            } catch (e: any) {
              toolResult = JSON.stringify({ error: e.message });
            }
          }

          // Append tool result to history
          currentMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // Recursively call LLM with new history (assistant tool_call + tool result)
        // Reset attempts for the next turn to avoid exhausting retries on successful tool usage
        attempt = 0;
        continue;
      }

      return {
        text: msg?.content?.trim() ?? "(maaf, lagi blank)",
        mode: responseMode,
      };
    } catch (err: any) {
      // Feature Detection: Check if model rejected tools
      if (tools.length > 0 && TOOLS_SUPPORTED) {
        // Common error codes for invalid parameters or unsupported features
        if (
          err?.status === 400 &&
          (err?.error?.message?.includes("tool") ||
            err?.error?.message?.includes("function"))
        ) {
          console.warn(
            "[LLM] Model does not support tools. Disabling tools for future calls.",
          );
          TOOLS_SUPPORTED = false;
          // Retry immediately without tools
          continue;
        }
      }

      const retriable = err?.status >= 500 || err?.name === "AbortError";
      if (!retriable) break;
      const backoffMs = 300 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    attempt++;
  }
  return { text: "(maaf, terjadi gangguan sementara)" };
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
    return out.text;
  } catch {
    return (history || "").slice(0, 200) + " … (ringkas sementara)";
  }
}

/**
 * Ekstraksi nama panggilan menggunakan LLM.
 * - Masukan: kalimat user yang memuat intent mengganti nama panggilan
 * - Keluaran: hanya nama panggilan baru (tanpa kata lain) atau null jika tidak yakin
 */
export async function extractNicknameLLM(
  userText: string,
): Promise<string | null> {
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
        setTimeout(
          () =>
            reject(Object.assign(new Error("timeout"), { name: "AbortError" })),
          timeoutMs,
        ),
      );
      const res: any = await Promise.race([
        openai.chat.completions.create({
          model: MODEL_ID,
          messages,
          temperature: 0.2,
        }),
        timeoutPromise,
      ]);
      const raw = (res.choices?.[0]?.message?.content ?? "").trim();
      const cleaned = raw.replace(/["'`]/g, "").trim();
      // ambil hanya huruf/koma titik penamaan umum, maksimal 4 kata
      const m = cleaned.match(
        /[A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.'-]{2,}){0,3}/,
      );
      const picked = (m ? m[0] : "").trim();
      if (!picked) return null;
      if (picked.length < 2 || picked.length > 60) return null;
      return picked
        .split(/\s+/)
        .filter(Boolean)
        .map(
          (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
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
