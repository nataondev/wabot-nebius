## Wabot Nebius — WhatsApp Bot + Nebius AI

Bot WA minimal yang terhubung ke Nebius AI Studio (kompatibel OpenAI) dengan memori ringkas, persona hot-reload, dan whitelist grup. Cepat dipakai sebagai template asisten WA yang hemat token.

### Tujuan & Fungsi

- Chat WA via Baileys (login QR, kirim/terima, typing presence)
- Jawab pakai LLM Nebius (retry + timeout)
- Memori per topik (ringkas otomatis, token-efisien)
- Deteksi topik baru (idle/kata kunci pembayaran, stok, dll.)
- Persona + policy injection ke prompt
- Flow nama panggilan (minta/ubah nama, heuristik + LLM)

### Teknologi

- Bun, TypeScript
- @whiskeysockets/baileys, qrcode-terminal
- OpenAI SDK (baseURL Nebius)
- SQLite via `bun:sqlite` (bawaan Bun)

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
# Edit .env: set NEBIUS_API_KEY (wajib), MODEL_ID & GROUP_WHITELIST (opsional)
```

Konfigurasi .env (ringkas):
- NEBIUS_API_KEY: wajib
- MODEL_ID: default `meta-llama/Meta-Llama-3.1-8B-Instruct`; gunakan `-fast` untuk latensi rendah (lihat env.example)
- GROUP_WHITELIST: CSV/baris-baru/JSON array; kosong ⇒ tolak semua grup
- DEV/NODE_ENV: DEV aktif saat bukan production dan `DEV !== "false"` (menampilkan info debug)
- PENDING_NAME_TTL_MS, TYPING_KEEPALIVE_MS, TYPING_SAFETY_STOP_MS: opsional

Lokasi data: kredensial WA di `./auth`, database SQLite di `./db/brain.db`.

Catatan: Bun otomatis memuat file `.env`, jadi tidak perlu paket `dotenv` atau konfigurasi tambahan.

## Menjalankan

```bash
bun run dev    # mode pengembangan (watch, NODE_ENV!=production)
# atau
bun run start  # mode produksi (script set NODE_ENV=production)
```

Pertama kali, terminal menampilkan QR. Buka WhatsApp → Linked devices → scan. Setelah “✅ WhatsApp connected”, bot siap.

## Penggunaan

- Chat akun WA yang login; jika belum ada identitas, bot minta nama panggilan (mis. “aku Rara”).
- Untuk grup, pastikan JID masuk `GROUP_WHITELIST`; jika kosong, semua grup ditolak.
- Bot merangkum percakapan agar konteks efisien; topik baru saat idle lama/kata kunci pembayaran/stok/refund.

## Tips Singkat

- Reset sesi WA: hapus folder `auth/`
- Reset memori: `bun run delete-db`
- Tidak perlu build native: database memakai `bun:sqlite` (bawaan Bun)
