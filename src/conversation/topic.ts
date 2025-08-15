import { TOPIC_INACTIVITY_MS } from "../config";

export const HARD_MARKERS = /(transfer|bayar|harga|invoice|rekening|refund|stok|order|beli)/i;
export const CARRY_BLOCK_MARKERS = /(transfer|bayar|stok|invoice|refund)/i;
const FOLLOWUP_HINT = /^(kalau|kalo|terus|trus|lanjut|yang itu|jam\s*\d+)/i;

export function shouldCreateNewTopic(latest: any, text: string) {
  if (!latest) return true;
  const idle = Date.now() - (latest.last_active as number);
  if (idle > TOPIC_INACTIVITY_MS) return true;
  if (HARD_MARKERS.test(text)) return true;
  if (FOLLOWUP_HINT.test(text)) return false;
  return false;
}

export function containsHardMarker(text: string) {
  return HARD_MARKERS.test(text);
}

export function blocksCarry(text: string) {
  return CARRY_BLOCK_MARKERS.test(text);
}

export function guessLabel(text: string) {
  const t = text.toLowerCase();
  if (t.includes("harga") || t.includes("transfer") || t.includes("bayar"))
    return "pembayaran";
  if (t.includes("stok") || t.includes("produk")) return "produk";
  if (t.includes("refund")) return "refund";
  return "umum";
}


