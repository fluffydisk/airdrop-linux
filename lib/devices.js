'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { ShareGateway, lanAddresses, interfaceSummary } = require('./device-share');
const { RelayClient } = require('./relay-client');
const { relayUrl } = require('./relay-protocol');
const { enrollDevice } = require('./connection-service');
const QRCode = require('qrcode');
const {healthFailure}=require('./connection-health');

class Devices {
  constructor({ directory, backend, service = {}, createInternetClient, createTailscaleClient, enroll = enrollDevice, createClient = options => new RelayClient(options), probe = gateway => gateway.probe(), probeLocal = gateway => gateway.probeLocal(), verificationAttempts = 30, verificationDelay = 2000 } = {}) {
    this.directory = directory; this.backend = backend; this.createClient = createClient; this.probe = probe;
    this.service = service; this.enroll = enroll;
    this.createInternetClient = createInternetClient;
    this.createTailscaleClient = createTailscaleClient;
    this.verificationAttempts=verificationAttempts;this.verificationDelay=verificationDelay;
    this.probeLocal=probeLocal;this.diagnostics={};this.tunnelRegistered=false;
    this.generation = 0; this.verification = 0; this.queue = Promise.resolve();
    this.state = { mode: 'private', status: 'starting', message: 'Preparing your connection…', url: '', qr: '' };
  }
  async initialize() {
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(path.join(this.directory, 'devices.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    this.preferences = {
      mode: saved.configured && ['private', 'internet', 'tailscale', 'lan', 'local'].includes(saved.mode) ? saved.mode : 'internet',
      provider: ['internet','tailscale','lan','private'].includes(saved.provider) ? saved.provider : ['internet','tailscale','lan','private'].includes(saved.mode)&&saved.configured ? saved.mode : 'internet',
      autoConnect: saved.autoConnect !== false, background: saved.backgroundChosen===true?saved.background===true:true,
      setupComplete: saved.setupComplete === true,
      backgroundChosen: saved.backgroundChosen === true,
      relayUrl: saved.relayUrl || process.env.AIRDROP_RELAY_URL || this.service.relayUrl || '',
      accessKey: saved.accessKey || process.env.AIRDROP_RELAY_ACCESS_KEY || '',
      credentialType: saved.credentialType || 'manual',
      deviceKey: /^[A-Za-z0-9_-]{43}$/.test(saved.deviceKey || '') ? saved.deviceKey : crypto.randomBytes(32).toString('base64url'),
      configured: !!saved.configured, onboarded: !!saved.onboarded, address: saved.address || ''
    };
    await this.save();
    if (!this.preferences.configured) this.state={mode:this.preferences.provider,status:'setup-required',message:'Choose a connection provider. Airdrop is the default; no account is needed.',url:'',qr:''};
    else if (this.preferences.autoConnect && this.preferences.mode !== 'local') {
      this.action(this.preferences.mode, this.preferences.address).catch(error => this.fail(error));
    } else this.state = { mode: 'local', status: 'local', message: 'Connection is stopped. Connect from Settings.', url: '', qr: '' };
  }
  async save() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'devices.json');
    const temp = file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(this.preferences), { mode: 0o600 });
    await fs.rename(temp, file);
  }
  async snapshot() {
    return { ...this.state,verifiedBy:this.verifiedBy||null,configured: !!this.preferences?.configured, onboarded: !!this.preferences?.onboarded, setupRequired: true, setupComplete: !!this.preferences?.setupComplete,
      serviceAvailable: !!this.preferences?.relayUrl, internetAvailable: !!this.createInternetClient, tailscaleAvailable: !!this.createTailscaleClient, pairedAt: this.pairedAt || 0,
      providers:[{id:'internet',label:'Airdrop (default)',available:!!this.createInternetClient},{id:'tailscale',label:'Tailscale',available:!!this.createTailscaleClient},{id:'lan',label:'Same Wi-Fi',available:true},...(this.preferences?.relayUrl?[{id:'private',label:'Managed Airdrop relay',available:true}]:[])],
      canVerifyWithPhone:this.state.mode==='internet'&&this.tunnelRegistered&&!!this.gateway?.origin&&this.diagnostics.local?.status==='passed'&&['error','reconnecting'].includes(this.state.status),diagnostics:structuredClone(this.diagnostics),
      preferences: { provider:this.preferences?.provider || 'internet',autoConnect: this.preferences?.autoConnect !== false, background: !!this.preferences?.background, relayUrl: this.preferences?.relayUrl || '', hasAccessKey: !!this.preferences?.accessKey }, interfaces: lanAddresses() };
  }
  enqueue(work) { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  connectionReport(){return {provider:this.state.mode,status:this.state.status,verifiedBy:this.verifiedBy||null,tunnelRegistered:this.tunnelRegistered,checks:structuredClone(this.diagnostics),interfaces:interfaceSummary()};}
  async phoneVerified(generation){
    if(generation!==this.generation||this.state.mode!=='internet'||!this.tunnelRegistered||!this.gateway)return;
    if(this.state.status!=='phone-verification'&&this.verifiedBy!=='phone')return;
    this.verifiedBy='phone';this.diagnostics.phone={status:'passed',checkedAt:new Date().toISOString()};
    if(this.state.status==='ready')return;
    ++this.verification;clearTimeout(this.retryTimer);this.retryResolve?.();this.retryResolve=null;
    await this.ready(generation,this.verification,this.gateway);
  }
  verifyWithPhone(){return this.enqueue(()=>this.beginPhoneVerification(this.generation));}
  async beginPhoneVerification(generation){
    const gateway=this.gateway;
    if(generation!==this.generation||this.state.mode!=='internet'||!this.tunnelRegistered||!gateway?.origin)throw Error('Reconnect Airdrop before verifying with your phone.');
    await this.probeLocal(gateway);
    if(generation!==this.generation||!this.tunnelRegistered)throw Error('Reconnect Airdrop before verifying with your phone.');
    ++this.verification;clearTimeout(this.retryTimer);this.retryResolve?.();this.retryResolve=null;
    const verification=this.verification,qr=await QRCode.toDataURL(gateway.url(),{width:256,errorCorrectionLevel:'M',margin:2});
    if(generation!==this.generation||verification!==this.verification||!this.tunnelRegistered)throw Error('Reconnect Airdrop before verifying with your phone.');
    this.state={mode:'internet',status:'phone-verification',message:'Scan this code with your phone to verify the connection. Try mobile data if this Wi-Fi cannot open the address.',url:'',qr:'',verificationUrl:gateway.url(),verificationQr:qr};
    return this.snapshot();
  }
  action(mode, address) { if(mode==='local')this.enrollmentRequest?.abort(); return this.enqueue(() => this.change(mode, address)); }
  completeSetup() { return this.enqueue(async () => {
    if (this.state.status !== 'ready' || !this.state.url || !this.state.qr) throw Error('Reconnect before finishing setup.');
    this.preferences.setupComplete = true; await this.save(); return this.snapshot();
  }); }
  configure(patch) {
    return this.enqueue(async () => {
      if (!patch || typeof patch !== 'object') throw Error('Invalid connection preferences');
      const next = { ...this.preferences };
      for (const key of ['autoConnect', 'background']) if (key in patch) {
        if (typeof patch[key] !== 'boolean') throw Error('Invalid connection preference');
        next[key] = patch[key];
        if (key === 'background') next.backgroundChosen = true;
      }
      if ('relayUrl' in patch) next.relayUrl = patch.relayUrl ? relayUrl(patch.relayUrl).origin : '';
      if ('accessKey' in patch) {
        if (typeof patch.accessKey !== 'string' || patch.accessKey.length > 1024 || /[\r\n]/.test(patch.accessKey)) throw Error('Invalid relay access key');
        if (patch.accessKey) { next.accessKey = patch.accessKey; next.credentialType = 'manual'; }
      }
      const reconnect = next.relayUrl !== this.preferences.relayUrl || next.accessKey !== this.preferences.accessKey;
      this.preferences = next; await this.save();
      if (reconnect && this.state.mode === 'private') { await this.stop(); return this.change('private'); }
      return this.snapshot();
    });
  }
  async change(mode, address) {
    if (!['local', 'lan', 'private', 'internet', 'tailscale'].includes(mode)) throw Error('Unknown connection mode');
    if (['private','internet','tailscale'].includes(mode) && this.state.mode===mode && this.client && !['error', 'disconnected'].includes(this.state.status)) return this.snapshot();
    await this.stop();
    this.diagnostics={};this.verifiedBy=null;
    this.preferences = { ...this.preferences, mode, ...(mode!=='local'?{provider:mode}:{}),configured: true, address: address || '' }; await this.save();
    this.state = { mode, status: 'starting', message: 'Starting connection…', url: '', qr: '' };
    if (mode === 'local') { this.state.status = 'local'; this.state.message = 'Connection stopped. Sharing links have been revoked.'; return this.snapshot(); }
    if (mode === 'private' && !this.preferences.relayUrl) {
      this.state.status = 'setup-required'; this.state.message = this.createInternetClient ? 'Choose free internet sharing or connect over the same trusted Wi-Fi. No account or server setup is needed.' : 'Connect your devices over the same trusted Wi-Fi.'; return this.snapshot();
    }
    const generation = this.generation;
    const proxyHost = mode==='internet' ? 'airdrop-'+crypto.randomBytes(16).toString('hex')+'.internal' : undefined;
    this.gateway = new ShareGateway({ backend: this.backend, secure: mode !== 'lan', proxyHost, onPair: () => { if(generation===this.generation)this.pairedAt=Date.now(); },onVerified:()=>{this.phoneVerified(generation).catch(error=>{if(generation===this.generation)this.fail(error);});} });
    try {
      if (mode === 'lan') {
        const available = lanAddresses(), selected = address || available[0]?.address;
        if (!available.some(i => i.address === selected)) throw Error('No supported private IPv4 address was found for Wi-Fi sharing. This can happen on IPv6-only, VPN-only or restricted networks. Airdrop internet sharing is independent of this address.');
        await this.gateway.listen(selected);
        this.state.status = 'checking'; this.state.message = 'Checking your Wi-Fi connection…';
        this.checkTask = this.check(generation).catch(error => { if(generation===this.generation)this.fail(error); });
        this.monitor = setInterval(() => {
          if (!lanAddresses().some(i => i.address === selected)) this.fail(Error('The selected LAN interface disconnected. Start LAN sharing again.'));
        }, 2000);
      } else if(mode==='tailscale'){
        if(!this.createTailscaleClient)throw Error('This package does not include the embedded Tailscale provider. Choose Airdrop or Wi-Fi.');
        const target=await this.gateway.listen();
        this.client=this.createTailscaleClient({target:target.target,token:this.gateway.token,onState:event=>{this.receive(event,generation).catch(error=>{if(generation===this.generation)this.fail(error);});}});
        this.client.start();
      } else if (mode==='internet') {
        if(!this.createInternetClient)throw Error('Free internet sharing is not available on this system. Use Wi-Fi sharing instead.');
        const target=await this.gateway.listen();
        this.client=this.createInternetClient({target:target.target,proxyHost,onState:event=>{this.receive(event,generation).catch(error=>{if(generation===this.generation)this.fail(error);});}});
        this.client.start();
        let checking = false;
        this.monitor=setInterval(async()=>{
          if(checking||generation!==this.generation||!this.gateway?.origin||!['ready','reconnecting'].includes(this.state.status))return;
          checking=true;
          try{
            if(this.verifiedBy==='phone'){await this.probeLocal(this.gateway);if(!this.tunnelRegistered)throw Error('Tunnel disconnected');}
            else {await this.probe(this.gateway);this.diagnostics.public={status:'passed',transport:this.gateway.probeTransport||'system',...(this.gateway.dnsFallback?{dnsFallback:this.gateway.dnsFallback}:{})};}
            if(generation===this.generation&&this.state.status==='reconnecting'&&this.verifiedBy!=='phone')await this.receive({status:'checking',origin:this.gateway.origin,message:'Checking your restored connection…'},generation);
          }catch(error){
            if(generation===this.generation){const failure=healthFailure(error);this.diagnostics[failure.scope]={status:'failed',code:failure.code,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{}),...(failure.scope==='public'?{transport:this.gateway?.probeTransport||'system',...(this.gateway?.dnsFallback?{dnsFallback:this.gateway.dnsFallback}:{})}:{})};this.verification++;this.state={mode:'internet',status:'reconnecting',message:failure.message+' Checking automatically. You can also verify from your phone.',url:'',qr:''};if(failure.scope==='public'&&failure.code==='DNS'&&this.tunnelRegistered&&this.diagnostics.local?.status==='passed')await this.beginPhoneVerification(generation).catch(()=>{});}
          }finally{checking=false;}
        },10000);
      } else {
        if (!this.preferences.accessKey || this.preferences.credentialType === 'enrolled') {
          this.state.status = 'enrolling'; this.state.message = 'Setting up your connection automatically…';
          this.enrollmentRequest = new AbortController();
          const key = await this.enroll({ url: this.preferences.relayUrl, deviceKey: this.preferences.deviceKey, signal: this.enrollmentRequest.signal });
          if (generation !== this.generation) return this.snapshot();
          this.preferences.accessKey = key; this.preferences.credentialType = 'enrolled'; await this.save();
        }
        const target = await this.gateway.listen();
        this.client = this.createClient({ url: this.preferences.relayUrl, accessKey: this.preferences.accessKey, deviceKey: this.preferences.deviceKey, target: target.target,
          onState: event => { this.receive(event, generation).catch(error => { if (generation === this.generation) this.fail(error); }); } });
        this.client.start();
      }
    } catch (error) { await this.stop(); this.state = { mode, status: 'error', message: error.message, url: '', qr: '' }; }
    return this.snapshot();
  }
  async receive(event, generation) {
    if (generation !== this.generation || !this.gateway || !['private','internet','tailscale'].includes(this.state.mode)) return;
    if(this.state.mode==='tailscale'&&event.verified&&this.state.status==='ready'&&this.gateway.origin===event.origin)return;
    if(this.state.mode==='internet'){if(event.origin)this.tunnelRegistered=true;else if(['error','reconnecting','disconnected'].includes(event.status))this.tunnelRegistered=false;}
    this.verification++;
    clearTimeout(this.retryTimer); this.retryResolve?.(); this.retryResolve = null;
    this.state = { mode: this.state.mode, status: event.status, message: event.message, authURL:event.authURL||'',url: '', qr: '' };
    if (event.origin) {
      this.gateway.setOrigin(event.origin);
      // The userspace node probes its private HTTPS address through s.Dial.
      // The host cannot route to that address without installing a host VPN.
      if(this.state.mode==='tailscale'){if(event.verified)await this.ready(generation,this.verification,this.gateway);}
      else await this.check(generation);
    }
  }
  async ready(generation,verification,gateway){
    const qr=await QRCode.toDataURL(gateway.url(),{width:256,errorCorrectionLevel:'M',margin:2});
    if(generation!==this.generation||verification!==this.verification||gateway!==this.gateway)return;
    this.verifiedBy ||= this.state.mode==='tailscale'?'tailscale':'desktop';
    this.state={mode:this.state.mode,status:'ready',message:'Your sharing connection is ready.',url:gateway.url(),qr};
    this.preferences.onboarded=true;this.enqueue(()=>this.save()).catch(error=>this.fail(error));
  }
  async check(generation) {
    // Advertise only after an authenticated round trip through the public relay.
    const gateway = this.gateway, verification = this.verification;
    const attempts=this.state.mode==='internet'?this.verificationAttempts:8;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (generation !== this.generation || verification !== this.verification || gateway !== this.gateway) return;
      try {
        await this.probeLocal(gateway);this.diagnostics.local={status:'passed'};
        await this.probe(gateway);this.diagnostics.public={status:'passed',transport:gateway.probeTransport||'system',...(gateway.dnsFallback?{dnsFallback:gateway.dnsFallback}:{})};
        if (generation !== this.generation || verification !== this.verification || gateway !== this.gateway) return;
        await this.ready(generation,verification,gateway);
        return;
      } catch (error) {
        if (generation !== this.generation || verification !== this.verification || gateway !== this.gateway) return;
        const failure=healthFailure(error,error?.scope||'public');this.diagnostics[failure.scope]={status:'failed',code:failure.code,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{}),...(failure.scope==='public'?{transport:gateway.probeTransport||'system',...(gateway.dnsFallback?{dnsFallback:gateway.dnsFallback}:{})}:{})};
        if(this.state.mode==='internet'&&failure.scope==='public'&&failure.code==='DNS'&&attempt>=2&&this.tunnelRegistered&&this.diagnostics.local?.status==='passed'){
          await this.beginPhoneVerification(generation);return;
        }
        if (attempt === attempts-1) { if (generation === this.generation) { this.state = { ...this.state, status: 'error', message: failure.message+(failure.scope==='local'?' The file service must be ready before connecting.':' Retry, verify with your phone, or choose another provider.'), url: '', qr: '' }; } return; }
        if(this.state.mode==='internet')this.state.message=`Tunnel connected. Waiting for DNS and HTTPS to become reachable (${attempt+1}/${attempts})… You can cancel or choose another provider.`;
        await new Promise(resolve => { this.retryTimer = setTimeout(resolve, this.state.mode==='internet'?this.verificationDelay:1000); this.retryResolve = resolve; });
      }
    }
  }
  fail(error) { const mode = this.state.mode; this.stop().catch(() => {}); this.state = { mode, status: 'error', message: error.message, url: '', qr: '' }; }
  async stop() {
    this.generation++; this.enrollmentRequest?.abort(); this.enrollmentRequest = null; clearInterval(this.monitor); this.monitor = null;
    this.tunnelRegistered=false;
    clearTimeout(this.retryTimer); this.retryResolve?.(); this.retryResolve = null;
    const client=this.client;this.client=null;
    this.pairedAt = 0;
    this.state.url = ''; this.state.qr = '';
    delete this.state.verificationUrl;delete this.state.verificationQr;
    const gateway = this.gateway; this.gateway = null;
    await Promise.all([gateway?.close(),client?.stop()]);
  }
}
module.exports = { Devices };
