'use strict';
// Sharing follows the saved/default setting and, for sandboxed packages,
// still requires a successful OS permission request.
class BackgroundPolicy {
  constructor({ source, request, snapEnabled = false } = {}) {
    this.source = source; this.request = request; this.snapEnabled = snapEnabled;
    this.active = false; this.pending = false; this.message = ''; this.generation = 0;
  }
  set(enabled){
    if(enabled&&this.active)return Promise.resolve(true);
    if(enabled&&this.pending&&this.inflight)return this.inflight;
    const request=this.change(enabled);this.inflight=request;
    const settled=()=>{if(this.inflight===request)this.inflight=null;};request.then(settled,settled);
    return request;
  }
  async change(enabled) {
    const generation = ++this.generation;
    this.controller?.abort(); this.active = false; this.pending = false;
    if (!enabled) { this.message = 'Sharing stops when you close Airdrop. It starts again when you reopen the app if automatic connection is enabled.'; return false; }
    this.pending = true;this.message='Requesting permission to keep sharing when the window closes…';this.controller = new AbortController();
    let granted = false;
    try {
      granted = this.source === 'flatpak' ? await this.request({ signal: this.controller.signal }) : this.source === 'snap' ? this.snapEnabled : true;
    } catch { granted = false; }
    if (generation !== this.generation) return false;
    this.pending = false; this.active = !!granted;
    this.message = granted ? 'Your connection stays active when the window closes. Reopen Airdrop to return, or Quit to stop sharing.' :
      this.source === 'snap' ? 'Enable the Snap background user service before turning this on.' : 'Background permission was not granted. Sharing stops when the window closes.';
    return this.active;
  }
  stop() { this.generation++; this.controller?.abort(); this.pending = false; this.active = false; }
  snapshot() { return { active: this.active, pending: this.pending, message: this.message }; }
}
module.exports = { BackgroundPolicy };
