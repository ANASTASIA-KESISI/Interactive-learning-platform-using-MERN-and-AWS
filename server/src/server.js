const { createApp } = require('./app');
const { env } = require('./config/env');
const { connectMongo } = require('./config/mongo');
const logger = require('./utils/logger');

const start = async () => {
  try {
    await connectMongo();
    const app = createApp();
    app.listen(env.port, () => {
      logger.info(`LearnCode API listening on port ${env.port}`, { env: env.nodeEnv });
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
};

start();
