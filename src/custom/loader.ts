import * as fs from "fs";
import * as path from "path";
import { Glob } from "bun";
import { CustomPlugin, PluginContext } from "./types";
import { logger } from "../utils/logger";

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
        logger.error("[custom]", `Failed to load plugin ${filePath}:`, e);
      }
    }

    loadedPlugins = newPlugins;
    logger.info("[custom]", `Loaded ${loadedPlugins.length} plugins.`);
  } catch (e) {
    logger.error("[custom]", "Error scanning plugins:", e);
  } finally {
    isReloading = false;
  }
}

export function startPluginWatcher() {
  // Ensure custom directory exists before scanning for plugins
  if (!fs.existsSync(CUSTOM_DIR)) {
    fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  }

  loadPlugins();

  watcher = fs.watch(CUSTOM_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith(".ts")) {
      logger.info("[custom]", `Change detected: ${filename}. Reloading...`);
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
        logger.error("[custom]", `Error executing plugin ${plugin.name}:`, e);
      }
    }
  }

  return false;
}
