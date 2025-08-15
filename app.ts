/*
  WhatsApp Bot + Nebius (fast flavor) — Minimal Template
  - Transport: Baileys (unofficial WA Web API)
  - LLM: Nebius AI Studio (OpenAI-compatible), e.g. "meta-llama/Meta-Llama-3.1-8B-Instruct-fast"
  - Memory: summary-based, per-topic, token-efficient (SQLite by default)

  Quick start:
  1) npm i @whiskeysockets/baileys qrcode-terminal openai
  2) export NEBIUS_API_KEY=... (from Nebius AI Studio)
  3) bunx tsx app.ts   (or)  npx tsx app.ts   (or compile with tsc)

  Notes:
  - Fast flavor: append "-fast" to model id (see Nebius docs)
  - Adjust MODEL_ID below to any supported fast model
*/

export * from "./src/app";

