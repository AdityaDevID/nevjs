export class Assets {
  constructor(loaders = {}) {
    this.items = new Map();
    this.queue = [];
    this.baseURL = '';
    this.loaders = {
      image: loaders.image ?? defaultImageLoader,
      json: loaders.json ?? defaultJsonLoader,
      text: loaders.text ?? defaultTextLoader,
      audio: loaders.audio ?? defaultAudioLoader,
    };
  }

  _add(type, key, url) {
    this.queue.push({ type, key, url });
    return this;
  }
  image(key, url) {
    return this._add('image', key, url);
  }
  json(key, url) {
    return this._add('json', key, url);
  }
  text(key, url) {
    return this._add('text', key, url);
  }
  audio(key, url) {
    return this._add('audio', key, url);
  }

  get(key) {
    if (!this.items.has(key)) throw new Error(`[nevg] Asset "${key}" is not loaded`);
    return this.items.get(key);
  }
  has(key) {
    return this.items.has(key);
  }

  async load(onProgress) {
    const jobs = this.queue.splice(0);
    let done = 0;
    if (!jobs.length) {
      onProgress?.(1);
      return this;
    }
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const value = await this.loaders[job.type](this.baseURL + job.url);
          this.items.set(job.key, value);
        } catch (err) {
          throw new Error(`[nevg] Failed to load ${job.type} "${job.key}" (${job.url}): ${err?.message ?? err}`);
        }
        onProgress?.(++done / jobs.length);
      }),
    );
    return this;
  }
}

function defaultImageLoader(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image error'));
    img.src = url;
  });
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
const defaultJsonLoader = async (url) => (await fetchOk(url)).json();
const defaultTextLoader = async (url) => (await fetchOk(url)).text();
const defaultAudioLoader = async (url) => (await fetchOk(url)).arrayBuffer();
