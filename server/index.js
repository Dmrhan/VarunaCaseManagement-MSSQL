import app from './app.js';

const PORT = process.env.PORT ?? 3101;

app.listen(PORT, () => {
  console.log(`[bff] Varuna Case Management BFF listening on http://localhost:${PORT}`);
});
