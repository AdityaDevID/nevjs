import * as THREE from 'three';
import { Game } from '@adityadevid/nevg';

export class Game3D extends Game {
  constructor({
    canvas = null,
    renderer = null,
    antialias = true,
    shadows = false,
    toneMapping = true,
    maxDpr = 2,
    adaptive = true,
    rendererOptions = {},
    width = 800,
    height = 600,
    ...rest
  } = {}) {
    super({ ...rest, canvas: null, width, height, maxDpr, fit: 'none' });
    this.three = THREE;
    this.renderer = renderer;
    this.shadows = shadows;
    this.adaptive = adaptive;
    this.maxDprLimit = maxDpr;
    this._antialias = antialias;
    this._toneMapping = toneMapping;
    this._rendererOptions = rendererOptions;
    this._adaptAt = 0;
    this._goodFor = 0;
    this.quality = 'high';
    if (canvas) this._setupCanvas(canvas);
    else if (renderer) this._applyRendererSettings();
  }

  _createContext(el) {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        canvas: el,
        antialias: this._antialias,
        powerPreference: 'high-performance',
        ...this._rendererOptions,
      });
    }
    this._applyRendererSettings();
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._lost = true;
      this.emit('contextlost');
    });
    el.addEventListener('webglcontextrestored', () => {
      this._lost = false;
      this.emit('contextrestored');
    });
    return null;
  }

  _applyRendererSettings() {
    const r = this.renderer;
    if (!r) return;
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.SRGBColorSpace;
    if (this._toneMapping && 'toneMapping' in r) r.toneMapping = THREE.ACESFilmicToneMapping;
    if (r.shadowMap) {
      r.shadowMap.enabled = !!this.shadows;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  _applySize() {
    const el = this.canvas;
    if (!el) return;
    const p = el.parentElement;
    const w = Math.max(1, Math.floor((p && p.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : this.width)));
    const h = Math.max(1, Math.floor((p && p.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : this.height)));
    const dpr = Math.max(0.5, Math.min(this.maxDpr, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    this.dpr = dpr;
    this.width = w;
    this.height = h;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.touchAction = 'none';
    el.style.display = 'block';
    if (this.renderer) {
      this.renderer.setPixelRatio?.(dpr);
      this.renderer.setSize(w, h, false);
    }
    this.scene?.onResize?.(w, h);
    this.emit('resize', w, h);
  }

  setQuality(level) {
    const table = { low: [1, false], medium: [1.5, true], high: [this.maxDprLimit, true] };
    const [dpr, shadows] = table[level] ?? table.high;
    this.quality = table[level] ? level : 'high';
    this.maxDpr = Math.min(dpr, this.maxDprLimit);
    if (this.renderer?.shadowMap) this.renderer.shadowMap.enabled = !!(this.shadows && shadows);
    this._applySize();
    this.emit('quality', this.quality);
    return this;
  }

  _adapt() {
    const now = this._now();
    if (now - this._adaptAt < 1000) return;
    this._adaptAt = now;
    const fps = this.stats.fps;
    if (!fps) return;
    if (fps < this.fps * 0.75 && this.maxDpr > 0.75) {
      this.maxDpr = Math.max(0.75, this.maxDpr - 0.25);
      this._goodFor = 0;
      this._applySize();
    } else if (fps >= this.fps * 0.95 && this.maxDpr < this.maxDprLimit) {
      if (++this._goodFor >= 5) {
        this.maxDpr = Math.min(this.maxDprLimit, this.maxDpr + 0.25);
        this._goodFor = 0;
        this._applySize();
      }
    } else this._goodFor = 0;
  }

  render() {
    if (!this.scene || !this.renderer || this._lost) return;
    if (this.adaptive) this._adapt();
    this.scene._render3d?.(this.renderer);
    const info = this.renderer.info?.render;
    if (info) {
      this.stats.drawCalls = info.calls;
      this.stats.triangles = info.triangles;
    }
    this.emit('render', this.renderer);
  }

  destroy() {
    super.destroy();
    this.renderer?.dispose?.();
  }
}
