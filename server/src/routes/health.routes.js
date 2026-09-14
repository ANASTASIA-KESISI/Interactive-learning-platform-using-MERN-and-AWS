const express = require('express');
const mongoose = require('mongoose');

const deployStamp = require('../config/deployStamp');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    // Which commit is actually serving traffic — the deploy pipeline's
    // verification signal, and the first thing to check when the live API
    // does not behave like the code on `dev`.
    commit: deployStamp.commit,
    deployedAt: deployStamp.deployedAt,
  });
});

module.exports = router;
