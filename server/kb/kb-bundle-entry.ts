/*
 * Varuna CSM entegrasyonu için bundle entry (Faz KB).
 *
 * esbuild --bundle ile C:\apps\VarunaCaseManagement-MSSQL\server\kb\kbCore.js
 * olarak paketlenir; CSM'in Express router'ı (routes/kbV1.js) bu modülü kullanır.
 * Yeniden üretmek için: CSM repo'sundaki scripts/build-kb-core.mjs
 */
export { ask } from "./src/lib/kb/ask";
export { retrieve } from "./src/lib/kb/retrieve";
export { kbStats, getKbDb, isVecAvailable } from "./src/lib/kb/db";
export { embedPendingChunks } from "./src/lib/kb/embedder";
export { categorize } from "./src/lib/cc/categorizer";
export { categorizeV2, suggestClose } from "./src/lib/cc/categorizer-v2";
export { runAnalysis, AnalyzeBodySchema } from "./src/lib/ticket";
export { CustomerSearchBlockedError } from "./src/lib/ticket/anonymizer";
export { env } from "./src/lib/env";
