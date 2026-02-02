import * as fs from "fs";
import * as path from "path";
import { Glob } from "bun";
import { CustomPlugin, PluginContext } from "./types";

const CUSTOM_DIR = path.resolve(process.cwd(), "custom");

let loadedPlugins: CustomPlugin[] = [];
let watcher: fs.FSWatcher | null = null;
let isReloading = false;

async function loadPlugins() {
  if (isReloading) return;
  isReloading = true;

  try {
    const glob = new Glob("**/*.ts");
    const files = [];

    for await (const file of glob.scan(CUSTOM_DIR)) {
      files.push(path.join(CUSTOM_DIR, file));
    }

    const newPlugins: CustomPlugin[] = [];
    const cacheBuster = Date.now();

    for (const filePath of files) {
      try {
        const mod = await import(`${filePath}?t=${cacheBuster}`);
        if (mod.default && typeof mod.default.execute === "function") {
          newPlugins.push(mod.default);
        }
      } catch (e) {
        console.error(`[Custom] Failed to load plugin ${filePath}:`, e);
      }
    }

    loadedPlugins = newPlugins;
    console.log(`[Custom] Loaded ${loadedPlugins.length} plugins.`);
  } catch (e) {
    console.error("[Custom] Error scanning plugins:", e);
  } finally {
    isReloading = false;
  }
}

export function startPluginWatcher() {
  loadPlugins();

  if (!fs.existsSync(CUSTOM_DIR)) {
    fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  }

  watcher = fs.watch(CUSTOM_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith(".ts")) {
      console.log(`[Custom] Change detected: ${filename}. Reloading...`);
      setTimeout(loadPlugins, 100);
    }
  });
}

export async function handleCustomCommand(
  ctx: PluginContext,
): Promise<boolean> {
  const { text, jid } = ctx;

  for (const plugin of loadedPlugins) {
    if (plugin.scope !== "all") {
      if (!Array.isArray(plugin.scope) || !plugin.scope.includes(jid)) {
        continue;
      }
    }

    let matched = false;
    for (const pattern of plugin.patterns) {
      if (typeof pattern === "string") {
        if (text === pattern) matched = true;
      } else if (pattern instanceof RegExp) {
        if (pattern.test(text)) matched = true;
      } else if (typeof pattern === "function") {
        if (pattern(text)) matched = true;
      }
      if (matched) break;
    }

    if (matched) {
      try {
        const handled = await plugin.execute(ctx);
        if (handled) return true;
      } catch (e) {
        console.error(`[Custom] Error executing plugin ${plugin.name}:`, e);
      }
    }
  }

  return false;
}
