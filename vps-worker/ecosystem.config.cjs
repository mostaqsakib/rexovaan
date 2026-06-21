// PM2 config — keeps the worker alive 24/7 and restarts on crash
module.exports = {
  apps: [
    {
      name: 'link-checker',
      script: 'worker.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '1500M',
      env: { NODE_ENV: 'production' },
      out_file: '/var/log/link-checker.out.log',
      error_file: '/var/log/link-checker.err.log',
      time: true,
    },
  ],
};
