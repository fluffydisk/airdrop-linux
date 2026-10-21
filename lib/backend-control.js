'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
function address(root) { return path.join(root, 'state/backend.sock'); }
async function ownedSocket(root) {
  const file = address(root);
  if (await fs.realpath(path.dirname(file)) !== path.dirname(file)) throw new Error('Unsafe backend control directory');
  const stat = await fs.lstat(file);
  if (!stat.isSocket() || stat.uid !== process.getuid()) throw new Error('Backend control socket is not owned by this user');
  return stat;
}
async function request(root, command = 'status') {
  if (!['status','stop'].includes(command)) throw new Error('Unknown backend control command');
  await ownedSocket(root);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address(root));
    let output = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('Backend control timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({command,root})+'\n'));
    socket.on('data', chunk => {
      output += chunk;
      if (output.length > 4096) socket.destroy(new Error('Invalid backend control response'));
    });
    socket.on('end', () => {
      try {
        const result = JSON.parse(output);
        if (result.source !== 'snap' || result.root !== root || typeof result.version !== 'string') throw new Error('Another installation owns this backend');
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}
async function listen(root, version, stop) {
  const file = address(root);
  // The parent is private user data, never a shared runtime directory.
  const parent = path.dirname(file);
  if (await fs.realpath(parent) !== parent) throw new Error('Unsafe backend control directory');
  const parentStat = await fs.stat(parent);
  if (parentStat.uid !== process.getuid() || (parentStat.mode & 0o077)) throw new Error('Backend control directory must be private');
  try {
    const previous = await ownedSocket(root);
    try { await request(root); throw new Error('Backend control socket is already in use'); }
    catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
      const current = await ownedSocket(root);
      if (current.ino !== previous.ino || current.dev !== previous.dev) throw new Error('Backend control socket changed');
      await fs.unlink(file);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = net.createServer(socket => {
    let input = '', handled = false;
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (handled) return;
      input += chunk;
      if (input.length > 256) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      handled = true;
      try {
        const message = JSON.parse(input.trim());
        const {command} = message;
        if (message.root !== root || !['status','stop'].includes(command)) { socket.destroy(); return; }
        socket.end(JSON.stringify({source:'snap', root, version}), () => {
          if (command === 'stop') stop();
        });
      } catch { socket.destroy(); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(file, resolve); });
  await fs.chmod(file, 0o600);
  return server;
}
module.exports = {request, listen};
