const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpError');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  logger.error('Unhandled error', {
    path: req.path,
    method: req.method,
    message: err.message,
    stack: err.stack,
  });

  res.status(500).json({ error: { message: 'Internal server error' } });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}` } });
};

module.exports = { errorHandler, notFoundHandler };
