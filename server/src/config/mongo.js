const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('../utils/logger');

let connectionPromise = null;

const connectMongo = () => {
  if (connectionPromise) {
    return connectionPromise;
  }

  mongoose.set('strictQuery', true);

  connectionPromise = mongoose
    .connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    })
    .then((connection) => {
      logger.info(`MongoDB connected: ${connection.connection.host}`);
      return connection;
    })
    .catch((err) => {
      connectionPromise = null;
      logger.error('MongoDB connection failed', { error: err.message });
      throw err;
    });

  return connectionPromise;
};

const disconnectMongo = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  connectionPromise = null;
};

module.exports = { connectMongo, disconnectMongo };
