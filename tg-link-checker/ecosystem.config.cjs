module.exports = {
  apps: [{
    name: 'tg-link-checker',
    script: 'bot.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '4G',
    env: { NODE_ENV: 'production' },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
