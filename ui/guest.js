'use strict';
(async () => {
  const status = document.getElementById('status'), token = location.hash.slice(1);
  history.replaceState(null, '', '/guest/');
  try {
    const response = await fetch('/guest/session', {method:'POST', headers:token?{Authorization:'Bearer '+token}:{}});
    if (!response.ok) throw Error('This guest session is unavailable. Ask for a new QR code.');
    const session = await response.json();
    for (const file of session.files) {
      const li=document.createElement('li'), a=document.createElement('a');
      a.href='/guest/download/'+file.id;a.textContent=file.name;a.download=file.name;li.append(a);document.getElementById('files').append(li);
    }
    if (!session.files.length) document.getElementById('files').textContent='No files shared in this session.';
    document.getElementById('content').hidden=false;
    status.textContent='Connected · session lasts up to 10 minutes';
    const input=document.getElementById('upload');
    document.getElementById('uploadSection').hidden=session.allowUploads===false;
    input.disabled=session.allowUploads===false;
    input.onchange=async()=>{
      input.disabled=true;
      try {
        for (const file of input.files) {
          if (file.size>100*1024*1024) throw Error(file.name+' exceeds 100 MiB.');
          status.textContent='Sending '+file.name+'…';
          const result=await fetch('/guest/upload?name='+encodeURIComponent(file.name),{method:'PUT',body:file});
          if(!result.ok) throw Error('Could not send '+file.name+'. The session may have expired or reached its upload limit.');
        }
        status.textContent='Files received by the computer.';input.value='';
      } catch(error) {status.textContent=error.message;} finally {input.disabled=false;}
    };
    setTimeout(()=>{input.disabled=true;status.textContent='Session expired. Ask for a new QR code.';},Math.max(0,session.expires-Date.now()));
  } catch(error) {status.textContent=error.message;}
})();
