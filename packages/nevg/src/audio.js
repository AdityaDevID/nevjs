export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = new Map();
    this.volume = 1;
    this.muted = false;
  }

  get supported() {
    return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
  }

  unlock() {
    if (!this.supported) return;
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  mute(on = true) {
    this.muted = on;
    if (this.master) this.master.gain.value = on ? 0 : this.volume;
  }

  async decode(key, arrayBuffer) {
    this.unlock();
    if (!this.ctx) return null;
    const buffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    this.buffers.set(key, buffer);
    return buffer;
  }

  play(key, { volume = 1, loop = false, rate = 1 } = {}) {
    const buffer = this.buffers.get(key);
    if (!this.ctx || !buffer) return () => {};
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
    return () => {
      try {
        src.stop();
      } catch {
      }
    };
  }

  beep({ freq = 440, duration = 0.1, type = 'square', volume = 0.2, slide = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }
}
