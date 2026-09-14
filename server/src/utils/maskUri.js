// A MongoDB connection string carries the password in its userinfo segment, so
// anything that echoes the raw URI drops the database credential into terminal
// scrollback, CI logs and screen shares. The scripts used to print it verbatim
// on connect; only the host is worth confirming, so that is all we log.
//
// `src/config/mongo.js` already logs `connection.host` for the running API —
// this helper gives the one-shot scripts the same discipline.
const maskMongoUri = (uri) => {
  try {
    const { protocol, hostname, pathname } = new URL(uri);
    return `${protocol}//${hostname}${pathname}`;
  } catch {
    return '<unparseable MONGODB_URI>';
  }
};

module.exports = { maskMongoUri };
