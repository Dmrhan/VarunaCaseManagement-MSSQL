import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Manuel chunk gruplama — App.tsx React.lazy import'ları bu gruplara düşer.
        // - vendor-recharts: 2+ analytics page'inde duplikasyonu önler
        // - vendor-icons: lucide-react büyük; vendor cache hit artar
        // - admin: 11 admin page tek chunk (SystemAdmin/Admin only)
        // - analytics: 4 analytics page tek chunk (Supervisor+ only)
        // - calendar: MyCalendarPage izole
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) return 'vendor-recharts';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('/src/features/admin/')) return 'admin';
          if (id.includes('/src/features/analytics/')) return 'analytics';
          if (id.includes('/src/features/my/MyCalendarPage')) return 'calendar';
        },
      },
    },
  },
});
