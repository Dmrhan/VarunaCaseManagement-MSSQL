import app from './app.js';
import { startCronScheduler } from './cronScheduler.js';

const PORT = process.env.PORT ?? 3101;

app.listen(PORT, () => {
  console.log(`[bff] Varuna Case Management BFF listening on http://localhost:${PORT}`);
  // Faz 5 — on-prem: zamanlanmış job'lar aynı süreçte koşar.
  startCronScheduler();
});
