'use strict';
const express = require('express');
const explorer = require('./explorer');
function router(root) {
  const api = express.Router();
  const json = express.json({ limit: '128kb' });
  const run = action => async (req, res, next) => { try { await action(req, res); } catch (error) { if (!error.status) error.status = ['ELOOP', 'ENOTDIR'].includes(error.code) ? 400 : error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : undefined; next(error); } };
  api.get('/', run(async (req, res) => res.json({ entries: await explorer.list(root, req.query.directory || '') })));
  api.post('/directories', json, run(async (req, res) => res.status(201).json(await explorer.mkdir(root, req.body.directory || '', req.body.name))));
  api.put('/file', run(async (req, res) => res.status(201).json(await explorer.upload(root, req.query.directory || '', req.query.name, req))));
  api.post('/copy', json, run(async (req, res) => res.status(201).json(await explorer.copy(root, req.body.directory || '', req.body.paths, req.body.name))));
  api.get('/trash', run(async (req, res) => res.json({ entries: await explorer.trashList(root) })));
  api.post('/trash', json, run(async (req, res) => res.json({ results: await explorer.trash(root, req.body.paths) })));
  api.post('/trash/:id/restore', run(async (req, res) => res.json(await explorer.restore(root, req.params.id))));
  const send = run(async (req, res) => {
    const paths = req.method === 'GET' ? [req.query.path] : typeof req.body.paths === 'string' ? JSON.parse(req.body.paths) : req.body.paths;
    if (req.body?.validateOnly === true) {
      const files = await explorer.collect(root, paths);
      await Promise.all(files.filter(file => file.handle).map(file => file.handle.close()));
      return res.json({ ok: true });
    }
    const result = await explorer.download(root, paths);
    result.stream.on('error', error => res.destroy(error));
    res.on('close', () => result.stream.destroy());
    res.type(result.type).attachment(result.name);
    result.stream.pipe(res);
  });
  api.get('/download', send);
  api.post('/download', json, express.urlencoded({ extended: false, limit: '128kb' }), send);
  return api;
}
module.exports = { router };
