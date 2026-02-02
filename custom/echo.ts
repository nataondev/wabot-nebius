import { CustomPlugin } from "../src/custom/types";

const plugin: CustomPlugin = {
  name: "Echo Test",
  patterns: ["/ping", /^\/echo (.+)/i],
  scope: "all",
  execute: async ({ sock, msg, text, jid }) => {
    if (text === "/ping") {
      await sock.sendMessage(jid, { text: "Pong! from custom plugin 🚀" });
      return true;
    }

    const match = text.match(/^\/echo (.+)/i);
    if (match) {
      await sock.sendMessage(jid, { text: `Echo: ${match[1]}` });
      return true;
    }

    return false;
  },
};

export default plugin;
