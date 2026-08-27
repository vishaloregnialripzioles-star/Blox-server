import express from 'express';

// Render terminates HTTPS at its proxy and forwards the request to Node over HTTP.
// The existing app uses secure session cookies, so Express must trust that proxy.
const originalDefaultConfiguration = express.application.defaultConfiguration;
express.application.defaultConfiguration = function (...args) {
  const result = originalDefaultConfiguration.apply(this, args);
  this.set('trust proxy', 1);
  return result;
};
