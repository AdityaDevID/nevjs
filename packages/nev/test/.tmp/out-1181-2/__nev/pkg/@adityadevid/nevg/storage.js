/**
 * Save data with defaults, versioning and safe fallbacks (localStorage → memory).
 *
 *   const save = new SaveData('my-game', { coins: 0, best: 0, settings: { sound: true } }, { version: 2,
 *     migrate: { 2: (old) => ({ ...old, settings: { sound: true } }) } })     // migrate[v] upgrades data to version v
 *   save.data.coins += 5;  save.save();      save.set('best', 12);     save.reset();
 */
export class SaveData {
  constructor(key, defaults = {}, { storage, version = 1, migrate = {} } = {}) {
    this.key = key;
    this.defaults = defaults;
    this.version = version;
    this.migrate = migrate;
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this._mem = null;
    this.data = this._fresh();
    this.load();
  }

  _fresh() {
    return structuredClone(this.defaults);
  }

  _read() {
    try {
      const raw = this.storage ? this.storage.getItem(this.key) : this._mem;
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Reload from storage. Missing keys come from the defaults; older versions are migrated. */
  load() {
    const saved = this._read();
    if (!saved || typeof saved !== 'object' || typeof saved.data !== 'object' || saved.data === null) {
      this.data = this._fresh();
      return false;
    }
    let data = saved.data;
    for (let v = (saved.version ?? 1) + 1; v <= this.version; v++) {
      if (this.migrate[v]) data = this.migrate[v](data) ?? data;
    }
    this.data = deepDefaults(data, this._fresh());
    return true;
  }

  save() {
    const raw = JSON.stringify({ version: this.version, data: this.data });
    try {
      if (this.storage) this.storage.setItem(this.key, raw);
      else this._mem = raw;
      return true;
    } catch {
      this._mem = raw; // quota / blocked → keep in memory for this session
      return false;
    }
  }

  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback;
  }

  /** Set a value and save. */
  set(key, value) {
    this.data[key] = value;
    return this.save();
  }

  reset() {
    this.data = this._fresh();
    try {
      this.storage?.removeItem?.(this.key);
    } catch {
      /* ignore */
    }
    this._mem = null;
  }
}

function deepDefaults(data, defaults) {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) return data;
  const out = { ...data };
  for (const k of Object.keys(defaults)) {
    if (!(k in out)) out[k] = defaults[k];
    else if (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) && out[k] && typeof out[k] === 'object') {
      out[k] = deepDefaults(out[k], defaults[k]);
    }
  }
  return out;
}
