import { WASocket, WAMessage } from "@whiskeysockets/baileys";

export interface PluginContext {
  sock: WASocket;
  msg: WAMessage;
  text: string;
  jid: string;
  sender: string;
  isGroup: boolean;
}

export interface CustomPlugin {
  name: string;
  patterns: (string | RegExp | ((text: string) => boolean))[];
  scope: "all" | string[];
  execute: (ctx: PluginContext) => Promise<boolean>;
}
