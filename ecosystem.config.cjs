// PM2 process-manager config. Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   # auto-start on reboot
//   pm2 logs face-embed       # tail
//   pm2 restart face-embed    # after code change
//
// pm2 isn't strictly required — systemd, supervisord, or `node server.js &` all
// work. PM2 just makes the "keep it alive + log rotate + start on boot" loop
// trivial on a typical VPS.

module.exports = {
  apps: [
    {
      name: 'face-embed',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',
      autorestart: true,
      max_restarts: 20,
      env: {
        NODE_ENV: 'production',
        FACE_EMBED_BIND: '127.0.0.1',
        FACE_EMBED_PORT: '8723',
        FACE_EMBED_DETECT_SIZE: '416',
        FACE_EMBED_SCORE_FLOOR: '0.5',
        FACE_EMBED_MAX_MB: '12',
        // FACE_EMBED_SHARED_KEY must be set per-host — DO NOT hardcode here.
        // Example: pm2 start ecosystem.config.cjs --env production
        //          or echo "FACE_EMBED_SHARED_KEY=..." >> ~/.pm2/env then pm2 restart.
      },
    },
  ],
};
