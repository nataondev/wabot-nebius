import { MODEL_ID } from "./config";
import { startWA } from "./wa";

console.log(`Using model: ${MODEL_ID}`);
console.log(
  `Using Nebius API key: ${process.env.NEBIUS_API_KEY ? "****" : "missing"}`
);

startWA().catch(console.error);


