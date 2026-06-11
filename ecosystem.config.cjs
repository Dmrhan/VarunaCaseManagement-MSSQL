/**
 * PM2 process tanımı (on-prem production).
 *
 * Başlat:   pm2 start ecosystem.config.cjs
 * Kalıcı:   pm2 save  (+ boot'ta otomatik: pm2-startup install)
 * Loglar:   logs/pm2-out.log, logs/pm2-err.log (pm2 logs varuna-cm)
 *
 * Not: exec_mode 'fork' KALMALI — cluster modunda gömülü cron scheduler
 * her instance'da ayrı koşar (job'lar idempotent ama gereksiz yük).
 */
module.exports = {
  apps: [
    {
      name: 'varuna-cm',
      script: 'server/index.js',
      cwd: __dirname,
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '600M',
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
