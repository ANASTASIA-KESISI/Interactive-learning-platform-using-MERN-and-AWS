const logger = require('../utils/logger');

// Emits one structured JSON line per request so CloudWatch Logs Insights can
// query them directly (`fields @timestamp, path, status, durationMs | filter
// status >= 400`). morgan's combined format is a single opaque string, which
// Insights can only regex over.
//
// Deliberately logged: method, route path, status, duration, and the
// authenticated caller's role. Deliberately NOT logged: request bodies (they
// carry learner source code), query strings, tokens, or the `authorization`
// header.
const requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('request', {
      method: req.method,
      // req.route is only populated once a handler matched; fall back to the
      // raw path so 404s are still visible.
      path: req.baseUrl ? `${req.baseUrl}${req.route?.path || ''}` : req.path,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      role: req.user?.role,
      ip: req.ip,
    });
  });

  next();
};

module.exports = { requestLogger };
