const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { env } = require('./config/env');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const meRoutes = require('./routes/me.routes');
const universitiesRoutes = require('./routes/universities.routes');
const studentRoutes = require('./routes/student.routes');
const coursesRoutes = require('./routes/courses.routes');
const lessonsRoutes = require('./routes/lessons.routes');
const instructorRoutes = require('./routes/instructor.routes');
const adminRoutes = require('./routes/admin.routes');
const progressRoutes = require('./routes/progress.routes');
const notesRoutes = require('./routes/notes.routes');
const messagesRoutes = require('./routes/messages.routes');

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
  app.use('/api/auth', authRoutes);
  app.use('/api/me', meRoutes);
  // Public: the signup form needs the university/department tree before an
  // account exists (S7 D4).
  app.use('/api/universities', universitiesRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/student', progressRoutes);
  app.use('/api/courses', coursesRoutes);
  app.use('/api/lessons', lessonsRoutes);
  app.use('/api/instructor', instructorRoutes);
  app.use('/api/admin', adminRoutes);
  // Empty routers today — Phase 1-C and 1-E fill them without touching app.js.
  app.use('/api/notes', notesRoutes);
  app.use('/api/messages', messagesRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
