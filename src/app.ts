import { MODEL_ID } from "./config";
import { startWA } from "./wa";
import { logger } from "./utils/logger";

logger.info("[app]", `Model: ${MODEL_ID}`);
logger.info(
  "[app]",
  `Nebius API key: ${process.env.NEBIUS_API_KEY ? "configured" : "missing"}`,
);

startWA().catch((err) => logger.error("[app]", "Fatal startWA error", err));
