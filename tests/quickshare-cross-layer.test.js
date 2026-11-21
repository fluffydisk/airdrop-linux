'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
test('interrupt correlation retains delivery ambiguity and requires an observed submission baseline',()=>{
 const out=JSON.parse(execFileSync('python',['-c',`
import importlib.util,json
s=importlib.util.spec_from_file_location('cross','scripts/quickshare-lab/cross-layer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def h(t):
 return dict(v=1,source='kernel',monoNs=t,stage='hci',**{k:0 for k in m.KERNEL['hci'].split()})
def u(t,count,submits):return dict(source='kernel',monoNs=t,stage='interrupt_pending',count=count,submits=submits,submit_errors=0,age_ns=t-1)
out=[]
for count,submits in [(1,10),(0,10),(1,0)]:
 out.append(m.analyze([h(1000000000),h(2000000000),u(1000000000,count,submits),u(2000000000,count,submits)])['signatures'][0])
print(json.dumps(out))
`],{encoding:'utf8'}));
 assert.equal(out[0].interruptContext.interpretation,'pending-at-both-samples-origin-unresolved');
 assert.equal(out[1].interruptContext.interpretation,'not-pending-at-both-samples-not-proof-of-resubmit-defect');
 assert.equal(out[2].interruptContext,undefined);
 assert.doesNotMatch(JSON.stringify(out),/firmware-confirmed|resubmit-defect-confirmed/);
});
test('LE lifecycle metadata preserves unknown failed-connection role and rejects private correlation fields',()=>{
 const out=JSON.parse(execFileSync('python',['-c',`
import importlib.util,json
s=importlib.util.spec_from_file_location('cross','scripts/quickshare-lab/cross-layer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
rows=[m.kernel_record(x) for x in ['ns=1 event=le_connect status=0 role=1','ns=2 event=le_connect status=62 role=255','ns=3 event=disconnect_raw status=0 reason=8']]
rejected=0
for x in ['ns=1 event=le_connect status=0 role=1 handle=1','ns=1 event=disconnect_raw status=0 reason=8 address=1']:
 try:m.kernel_record(x)
 except ValueError:rejected+=1
print(json.dumps(dict(rows=rows,rejected=rejected)))
`],{encoding:'utf8'}));
 assert.equal(out.rows[1].role,255);assert.equal(out.rows[2].reason,8);assert.equal(out.rejected,2);
 assert.doesNotMatch(JSON.stringify(out),/handle|address/);
});
test('compiler stdout warnings are reported separately from capture loss without exporting diagnostic text',()=>{
 const out=JSON.parse(execFileSync('python',['-c',`
import importlib.util,json,tempfile,pathlib
s=importlib.util.spec_from_file_location('cross','scripts/quickshare-lab/cross-layer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as td:
 d=pathlib.Path(td);results=[m.diagnostic_flags(d)]
 (d/'kernel.log').write_text('WARNING: signedness mismatch PRIVATE-SOURCE\\nns=1 event=trace_end\\n')
 (d/'kernel-errors.log').write_text('Attached 25 probes\\n')
 results.append(m.diagnostic_flags(d))
 (d/'kernel-errors.log').write_text('Lost 2 events\\n')
 results.append(m.diagnostic_flags(d))
 (d/'kernel.log').write_text('ERROR: compile failed\\n')
 results.append(m.diagnostic_flags(d));print(json.dumps(results))
`],{encoding:'utf8'}));
 assert.equal(out[0].kernelWarningsOrLoss,false);
 assert.equal(out[1].kernelCompilerWarnings,true);assert.equal(out[1].kernelReportedLoss,false);
 assert.equal(out[2].kernelReportedLoss,true);assert.equal(out[3].kernelDiagnosticErrors,true);
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE-SOURCE|signedness|compile failed/);
});
test('cross-layer reducer separates ingress, dispatch and accounting without invented firmware verdicts',()=>{
 const out=JSON.parse(execFileSync('python',['-c',`
import importlib.util,json
s=importlib.util.spec_from_file_location('cross','scripts/quickshare-lab/cross-layer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def row(t,**kw):
 d={k:0 for k in m.KERNEL['hci'].split()};d.update(kw);return m.kernel_record('ns='+str(t)+' event=hci '+ ' '.join(k+'='+str(v) for k,v in d.items()))
a=row(1000000000);results=[]
for changes in [dict(driver13=1),dict(raw13=1),dict(raw13=1,dispatch13=1),dict(raw13=1,dispatch13=1,handlers=1),dict(acl_complete=1),dict(acl_queue=-1)]:results.append(m.analyze([a,row(2000000000,**changes)])['signatures'])
rejected=0
for text in ['ns=1 event=hci address=123','ns=1 event=PRIVATE secret=1','ns=1 event=trace_end extra=1','@pointer[0x1234]: 7','ns=1 event=trace_end junk','ns=1 event=command_status opcode=1 opcode=2 status=0']:
 try:m.kernel_record(text)
 except ValueError:rejected+=1
for obj in [dict(v=1,source='app',clock='monotonic',monoNs=1,stage='PRIVATE-NAME',a=0,b=0,lost=0),dict(v=1,source='app',clock='boottime',monoNs=1,stage='state',a=0,b=0,lost=0)]:
 try:m.app_record(json.dumps(obj))
 except ValueError:rejected+=1
print(json.dumps({'results':results,'rejected':rejected}))
`],{encoding:'utf8'}));
 assert.equal(out.results[0][0].classification,'driver-reassembled-to-hci-ingress-no-progress');
 assert.equal(out.results[1][0].classification,'hci-ingress-to-dispatch-no-progress');
 assert.equal(out.results[2][0].classification,'dispatch-to-ncp-handler-no-progress');
 assert.match(out.results[3][0].classification,/not-necessarily-error/);
 assert.equal(out.results[4].length,0);
 assert.equal(out.results[5][0].classification,'counter-reset-coverage-invalid');
 assert.equal(out.rejected,8);
 assert.doesNotMatch(JSON.stringify(out),/firmware-confirmed|PRIVATE-NAME|secret/);
});
test('kernel diagnostic never exports correlation maps and uses explicit monotonic domain',()=>{
 const fs=require('node:fs'),s=fs.readFileSync('scripts/quickshare-cross-layer.bt','utf8');
 const maps=new Set([...s.matchAll(/@(\w+)/g)].map(m=>m[1]));
 for(const key of maps)assert.ok(s.includes(`clear(@${key});`),key);
 assert.doesNotMatch(s,/\b(buf|str|macaddr|ntop|override|signal|system)\s*\(/);
 assert.doesNotMatch(s,/nsecs\s*(?!\(monotonic\))\b/);
 assert.match(s,/interval:s:180/);
 assert.match(s,/hci_recv_frame/);assert.match(s,/hci_event_packet/);
});
test('lab forwarding requires a private owned actual socket and rejects file/symlink/public scope',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
 const {traceSocket}=require('../scripts/quickshare-lab/trace-socket.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-t30-'));await fs.chmod(dir,0o700);
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const socket=path.join(dir,'app.sock'),server=net.createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
 t.after(()=>new Promise(r=>server.close(r)));await fs.chmod(socket,0o600);
 assert.equal(traceSocket(undefined),null);assert.equal(traceSocket(socket),socket);
 const file=path.join(dir,'regular');await fs.writeFile(file,'private',{mode:0o600});assert.throws(()=>traceSocket(file));
 const link=path.join(dir,'link');await fs.symlink(socket,link);assert.throws(()=>traceSocket(link));
 await fs.chmod(dir,0o755);assert.throws(()=>traceSocket(socket));await fs.chmod(dir,0o700);
});
test('real bounded collector stores only validated datagrams, uses monotonic origin and cleans owned socket',()=>{
 const out=JSON.parse(execFileSync('python',['-c',`
import tempfile,pathlib,subprocess,socket,time,json
with tempfile.TemporaryDirectory(prefix='s24-t30-') as td:
 d=pathlib.Path(td);p=subprocess.Popen(['python','scripts/quickshare-lab/cross-layer.py','--directory',td,'--seconds','2'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(40):
   if (d/'collector-ready.json').exists():break
   time.sleep(.025)
  s=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM);s.connect(str(d/'app.sock'))
  s.send(json.dumps(dict(v=1,source='app',clock='monotonic',monoNs=time.monotonic_ns(),stage='state',a=1,b=0,lost=0)).encode())
  s.send(b'{"secret":"PRIVATE-CODE"}');s.close()
  p.wait(timeout=5);assert p.returncode==0
  rows=[json.loads(x) for x in (d/'timeline.jsonl').read_text().splitlines()]
  status=json.loads((d/'collector-status.json').read_text());print(json.dumps(dict(rows=rows,status=status,socketRemaining=(d/'app.sock').exists())))
 finally:
  if p.poll() is None:p.kill();p.wait()
`],{encoding:'utf8'}));
 assert.equal(out.rows.filter(r=>r.source==='app').length,1);assert.equal(out.status.rejected,1);assert.equal(out.socketRemaining,false);
 assert.ok(out.rows.every(r=>r.receivedMonoNs>=r.monoNs));assert.equal(out.status.audioCaptured,false);
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE-CODE|secret/);
});
