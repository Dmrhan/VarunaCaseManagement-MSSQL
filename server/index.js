import app from './app.js';
import { startCronScheduler } from './cronScheduler.js';

const PORT = process.env.PORT ?? 3101;
// IIS/nginx reverse proxy arkasında HOST=127.0.0.1 ver — port dışarıya kapanır.
const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`[bff] Varuna Case Management BFF listening on http://${HOST}:${PORT}`);
  // Faz 5 — on-prem: zamanlanmış job'lar aynı süreçte koşar.
  startCronScheduler();
});
