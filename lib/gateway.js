'use strict';
const express = require('express');
const http = require('node:http');
function createGateway({ api, uiDir, fileServer = 'http://127.0.0.1:5000' }) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/ui', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).set('Allow', 'GET, HEAD').json({ error: 'Application files are read-only' });
    next();
  }, express.static(uiDir, { dotfiles: 'deny', fallthrough: false, index: 'index.html', setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); } }));
  app.use('/push', api);
  app.use(async (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    try { const release = await require('./maintenance').acquire(api.locals?.maintenanceRoot); res.once('finish', release); res.once('close', release); next(); }
    catch (error) { next(error); }
  });
  app.use((req, res) => {
    const target = new URL(fileServer);
    const headers = { ...req.headers, host: target.host };
    delete headers.connection;
    const upstream = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: req.originalUrl, headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers);
      incoming.on('error', () => res.destroy());
      incoming.pipe(res);
      res.on('close', () => incoming.destroy());
    });
    upstream.on('error', () => {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy(); else res.status(503).json({ error: 'Shared files are temporarily unavailable' });
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Application resource unavailable' }));
  return app;
}
module.exports = { createGateway };
