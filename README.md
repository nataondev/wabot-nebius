## Wabot Nebius — WhatsApp Bot + Nebius AI

Bot WA minimal yang terhubung ke Nebius AI Studio (kompatibel OpenAI) dengan memori ringkas, persona hot-reload, dan whitelist grup. Cepat dipakai sebagai template asisten WA yang hemat token.

### Tujuan & Fungsi

- Chat WA via Baileys (login QR, kirim/terima, typing presence)
- Jawab pakai LLM Nebius (retry + timeout)
- Memori per topik (ringkas otomatis, token-efisien)
- Deteksi topik baru (idle/kata kunci pembayaran, stok, dll.)
- Persona + policy injection ke prompt
- Flow nama panggilan (minta/ubah nama, heuristik + LLM)
- **NEW**: Custom Plugin System (hot-reload)
- **NEW**: Mode Operasi (Personal/Group/All) & Whitelist Eksternal
- **NEW**: Logic Grup Cerdas (Passive Mode, Multi-user Context, Quote Reply)

### Teknologi

- Bun, TypeScript
- @whiskeysockets/baileys, qrcode-terminal
- OpenAI SDK (baseURL Nebius)
- SQLite via `bun:sqlite` (bawaan Bun)
- Prettier (Code Formatting)

## Prasyarat

- Bun terbaru: lihat dokumentasi [Bun](https://bun.sh/)
- Akun [Nebius AI Studio](https://studio.nebius.com/) + NEBIUS_API_KEY aktif
- Aplikasi WhatsApp di ponsel (untuk scan QR)
- Linux/macOS/WSL disarankan; tidak perlu build native karena menggunakan `bun:sqlite`

## Instalasi & Konfigurasi

```bash
git clone https://github.com/nataondev/wabot-nebius && cd wabot-nebius
bun install
cp env.example .env
# Edit .env: set NEBIUS_API_KEY (wajib)
```

### Konfigurasi `.env`

- `NEBIUS_API_KEY`: wajib
- `MODE`: `all` (default), `personal_only` (tolak grup), atau `group_only` (tolak chat pribadi)
- `MODEL_ID`: default `meta-llama/Meta-Llama-3.1-8B-Instruct`
- `DEV`: Mode debug (log lebih detail)

### Whitelist Grup

Tidak lagi di `.env`, melainkan di file `groups.txt` di root folder.
Isi satu JID per baris. Perubahan pada file ini langsung terdeteksi tanpa restart bot (Hot Reload).

```text
# groups.txt
120363023456789@g.us
120363098765432@g.us
```

### Custom Plugins

Folder `custom/` berfungsi untuk menambahkan script fitur tambahan tanpa mengganggu kode inti.
- **Hot Reload**: File `.ts` di dalam `custom/` otomatis dimuat ulang saat disimpan.
- **Scope**: Bisa jalan di semua chat atau hanya whitelist tertentu.
- **Prioritas**: Plugin dijalankan **sebelum** LLM.

Contoh `custom/ping.ts`:
```typescript
import { CustomPlugin } from "../src/custom/types";

const plugin: CustomPlugin = {
  name: "Ping",
  patterns: ["/ping"],
  scope: "all",
  execute: async ({ sock, jid }) => {
    await sock.sendMessage(jid, { text: "Pong!" });
    return true; // Stop processing
  }
};
export default plugin;
```

## Menjalankan

```bash
bun run dev    # mode pengembangan (watch, NODE_ENV!=production)
# atau
bun run start  # mode produksi (script set NODE_ENV=production)
```

Pertama kali, terminal menampilkan QR. Buka WhatsApp → Linked devices → scan. Setelah “✅ WhatsApp connected”, bot siap.

## Code Style

Project ini menggunakan **Prettier**. Jalankan perintah ini untuk merapikan kode:
```bash
bunx prettier --write .
```

## Penggunaan & Fitur Baru

### Identitas di Grup
Bot kini bisa membedakan antara **Room Chat** (Grup) dan **Pengirim** (User).
- **Passive Learning**: Di grup, bot tidak akan memaksa bertanya nama ("Siapa namamu?"). Bot belajar nama jika user menyebutkannya ("Panggil aku Budi").
- **Context Awareness**: LLM menerima format `[Budi]: Halo`, sehingga tahu siapa yang bicara.
- **Smart Reply**: Bot otomatis memilih apakah perlu me-reply (quote) pesan user atau menjawab umum, tergantung konteks.

### Fitur Standar
- Chat akun WA yang login; jika belum ada identitas, bot minta nama panggilan (mis. “aku Rara”).
- Untuk grup, pastikan JID masuk `groups.txt` (jika mode `group_only` atau `all`).
- Bot merangkum percakapan agar konteks efisien; topik baru saat idle lama/kata kunci pembayaran/stok/refund.

## Tips Singkat

- Reset sesi WA: hapus folder `auth/`
- Reset memori: `bun run delete-db`
- Tidak perlu build native: database memakai `bun:sqlite` (bawaan Bun)
