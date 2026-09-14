const express = require('express');
const universityService = require('../services/universityService');

const router = express.Router();

// GET /api/universities — PUBLIC. The signup form needs the university and
// department selects before an account (and therefore a token) exists. The
// payload is institutional reference data with no user content in it; the
// app-wide `/api` rate limiter in app.js covers abuse.
router.get('/', async (_req, res, next) => {
  try {
    res.json({ data: await universityService.listWithDepartments() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
