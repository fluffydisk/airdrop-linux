'use strict';
const express = require('express');
const explorer = require('./explorer');
const crypto = require('node:crypto');
function router(root) {
  const api = express.Router();
  const downloads = new Map();
  const json = express.json({ limit: '128kb' });
  const run = action => async (req, res, next) => { try { await action(req, res); } catch (error) { if (!error.status) error.status = ['ELOOP', 'ENOTDIR'].includes(error.code) ? 400 : error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : undefined; next(error); } };
  api.get('/', run(async (req, res) => res.json({ entries: await explorer.list(root, req.query.directory || '') })));
  api.post('/directories', json, run(async (req, res) => res.status(201).json(await explorer.mkdir(root, req.body.directory || '', req.body.name))));
  api.put('/file', run(async (req, res) => res.status(201).json(await explorer.upload(root, req.query.directory || '', req.query.name, req))));
  api.post('/copy', json, run(async (req, res) => res.status(201).json(await explorer.copy(root, req.body.directory || '', req.body.paths, req.body.name))));
  api.post('/move', json, run(async (req, res) => res.json(await explorer.move(root, req.body.directory || '', req.body.paths))));
  api.post('/trash/delete', json, run(async (req, res) => res.json(await explorer.deleteTrash(root, req.body.ids))));
  api.get('/trash', run(async (req, res) => res.json({ entries: await explorer.trashList(root) })));
  api.post('/trash', json, run(async (req, res) => res.json({ results: await explorer.trash(root, req.body.paths) })));
  api.post('/trash/:id/restore', run(async (req, res) => res.json(await explorer.restore(root, req.params.id))));
  const send = run(async (req, res) => {
    let paths = req.method === 'GET' ? [req.query.path] : typeof req.body.paths === 'string' ? JSON.parse(req.body.paths) : req.body.paths;
    if(req.method==='GET'&&req.query.ticket){
      const ticket=downloads.get(req.query.ticket);downloads.delete(req.query.ticket);
      if(!ticket||ticket.expires<Date.now())return res.status(410).json({error:'This download expired. Select Download again.'});
      paths=ticket.paths;
    }
    if (req.body?.validateOnly === true) {
      const files = await explorer.collect(root, paths);
      await Promise.all(files.filter(file => file.handle).map(file => file.handle.close()));
      if(req.body.createTicket===true){
        for(const [id,ticket]of downloads)if(ticket.expires<Date.now())downloads.delete(id);
        if(downloads.size>=100)return res.status(429).json({error:'Too many pending downloads. Try again shortly.'});
        const ticket=crypto.randomBytes(24).toString('hex');downloads.set(ticket,{paths,expires:Date.now()+120000});
        return res.json({ok:true,ticket});
      }
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
