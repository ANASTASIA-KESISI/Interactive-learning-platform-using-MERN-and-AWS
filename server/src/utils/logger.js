const emit = (level, message, meta) => {
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta || {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
};

module.exports = {
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
  debug: (message, meta) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', message, meta);
  },
};
