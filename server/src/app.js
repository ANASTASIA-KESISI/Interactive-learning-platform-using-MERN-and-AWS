const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { env } = require('./config/env');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const healthRoutes = require('./routes/health.routes');
const studentRoutes = require('./routes/student.routes');
const coursesRoutes = require('./routes/courses.routes');
const lessonsRoutes = require('./routes/lessons.routes');
const instructorRoutes = require('./routes/instructor.routes');
const adminRoutes = require('./routes/admin.routes');
const progressRoutes = require('./routes/progress.routes');

const createApp = () => {
  const app = express();

  app.disable('x-powered-by');

  // Behind an ALB / Amplify / nginx, the client address arrives in
  // X-Forwarded-For. Without this every request appears to come from the proxy,
  // which makes the rate limiter bucket the entire user base together and logs
  // the proxy's address instead of the caller's. Scoped to production so local
  // dev cannot be spoofed by a forged header.
  if (env.isProduction) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  if (!env.isTest) {
    app.use(requestLogger);
  }

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/health', healthRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/student', progressRoutes);
  app.use('/api/courses', coursesRoutes);
  app.use('/api/lessons', lessonsRoutes);
  app.use('/api/instructor', instructorRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
