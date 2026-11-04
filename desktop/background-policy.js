'use strict';
// Closing the window may keep sharing alive only after explicit opt-in and,
// for sandboxed packages, a successful OS permission request.
class BackgroundPolicy {
  constructor({ source, request, snapEnabled = false } = {}) {
    this.source = source; this.request = request; this.snapEnabled = snapEnabled;
    this.active = false; this.pending = false; this.message = ''; this.generation = 0;
  }
  async set(enabled) {
    const generation = ++this.generation;
    this.controller?.abort(); this.active = false; this.pending = false;
    if (!enabled) { this.message = 'Sharing stops when you close Airdrop. It starts again when you reopen the app if automatic connection is enabled.'; return false; }
    this.pending = true; this.controller = new AbortController();
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
