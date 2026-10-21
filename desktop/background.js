'use strict';
const { spawn, execFile } = require('node:child_process');
// Listen before calling RequestBackground: the response can arrive immediately.
function requestBackground({ spawnProcess = spawn, call = execFile, timeout = 60000, signal } = {}) {
  return new Promise(resolve => {
    const token = `airdrop${process.pid}`;
    const monitor = spawnProcess('gdbus',['monitor','--session','--dest','org.freedesktop.portal.Desktop']);
    let buffer = '', requested = false, done = false;
    const timer = setTimeout(()=>finish(false),timeout);
    function finish(granted) { if(done)return; done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);monitor.kill();resolve(granted); }
    function abort(){finish(false);}
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){finish(false);return;}
    monitor.on('error',()=>finish(false)); monitor.on('exit',()=>finish(false));
    monitor.stdout.on('data',chunk=>{
      buffer = (buffer + chunk).slice(-16384);
      if (!requested && buffer.includes('Monitoring signals')) {
        requested = true;
        const options = `{'handle_token': <'${token}'>, 'reason': <'Keep sharing files after closing the window'>, 'autostart': <false>}`;
        call('gdbus',['call','--session','--dest','org.freedesktop.portal.Desktop','--object-path','/org/freedesktop/portal/desktop','--method','org.freedesktop.portal.Background.RequestBackground','',options], error=>{if(error)finish(false);});
      }
      const response=buffer.split('\n').find(line=>line.includes('/'+token+':') && line.includes('Request.Response'));
      if(response)finish(/\(uint32 0,/.test(response) && /'background': <true>/.test(response));
    });
    monitor.stderr.on('data',()=>{});
  });
}
module.exports = { requestBackground };
