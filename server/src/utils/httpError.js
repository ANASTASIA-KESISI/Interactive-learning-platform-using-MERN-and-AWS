class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = (message = 'Unauthorized') => new HttpError(401, message);
const forbidden = (message = 'Forbidden') => new HttpError(403, message);
const notFound = (message = 'Not found') => new HttpError(404, message);
const conflict = (message, details) => new HttpError(409, message, details);

// 503, not 500. A runner that was never deployed, a Cognito group that does not
// exist in this pool, a capability the environment simply lacks: those are gaps
// in THIS deployment's wiring, not faults in the request and not crashes in the
// code. Status is the part of the response every caller reads, and a 500 sends
// whoever sees it hunting for a bug that isn't there — while `errorHandler`
// deliberately replaces an unrecognised error's message with "Internal server
// error", so the one sentence naming the missing piece never reaches them.
// 503 with a real message says "this is not available here", which is both true
// and actionable.
const serviceUnavailable = (message = 'Service unavailable', details) =>
  new HttpError(503, message, details);

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serviceUnavailable,
};
