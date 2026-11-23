// Tiny schema validation:  v.object({ name: v.string({ min: 1 }), age: v.number({ int: true }).optional() })

import { HttpError } from './http-error.js';

class Schema {
  constructor(kind, check) {
    this.kind = kind;
    this._check = check; // (value, path, ctx) => coerced value; pushes into ctx.errors
    this._optional = false;
    this._default = undefined;
    this._hasDefault = false;
    this._nullable = false;
    this._after = [];
  }

  _clone() {
    const s = new Schema(this.kind, this._check);
    s._optional = this._optional;
    s._default = this._default;
    s._hasDefault = this._hasDefault;
    s._nullable = this._nullable;
    s._after = this._after.slice();
    return s;
  }

  /** Accept `null` as a valid value (kept as null). */
  nullable() {
    const s = this._clone();
    s._nullable = true;
    return s;
  }

  /** Extra check: fn(value) returns true / false / an error message string. */
  refine(fn, message = 'is invalid') {
    const s = this._clone();
    s._after.push((val, path, ctx) => {
      const r = fn(val);
      if (r === true || r === undefined) return val;
      ctx.errors.push({ path, message: typeof r === 'string' ? r : message });
      return val;
    });
    return s;
  }

  /** Convert the validated value: v.string().transform((s) => s.toLowerCase()). */
  transform(fn) {
    const s = this._clone();
    s._after.push((val) => fn(val));
    return s;
  }

  optional() {
    const s = this._clone();
    s._optional = true;
    return s;
  }

  default(value) {
    const s = this._clone();
    s._optional = true;
    s._default = value;
    s._hasDefault = true;
    return s;
  }

  _run(value, path, ctx) {
    if (value === null && this._nullable) return null;
    const empty = value === undefined || value === null || (ctx.coerce && value === '');
    if (empty) {
      if (this._hasDefault) return typeof this._default === 'function' ? this._default() : this._default;
      if (this._optional) return undefined;
      ctx.errors.push({ path, message: 'is required' });
      return undefined;
    }
    const before = ctx.errors.length;
    let out = this._check(value, path, ctx);
    if (ctx.errors.length > before) return out;
    for (const step of this._after) {
      out = step(out, path, ctx);
      if (ctx.errors.length > before) break;
    }
    return out;
  }

  /** @returns {{ ok: boolean, value: any, errors: {path: string, message: string}[] }} */
  safeParse(value, options = {}) {
    const ctx = { coerce: !!options.coerce, errors: [] };
    const out = this._run(value, '', ctx);
    return { ok: ctx.errors.length === 0, value: out, errors: ctx.errors };
  }

  /** Throws HttpError(422) on failure. */
  parse(value, options) {
    const r = this.safeParse(value, options);
    if (!r.ok) throw new HttpError(422, 'Validation failed', r.errors);
    return r.value;
  }
}

const fail = (ctx, path, message) => {
  ctx.errors.push({ path, message });
  return undefined;
};

export const v = {
  string({ min, max, pattern, email, trim = false } = {}) {
    return new Schema('string', (val, path, ctx) => {
      if (typeof val !== 'string') {
        if (ctx.coerce && (typeof val === 'number' || typeof val === 'boolean')) val = String(val);
        else return fail(ctx, path, 'must be a string');
      }
      if (trim) val = val.trim();
      if (min != null && val.length < min) return fail(ctx, path, `must be at least ${min} character${min === 1 ? '' : 's'}`);
      if (max != null && val.length > max) return fail(ctx, path, `must be at most ${max} character${max === 1 ? '' : 's'}`);
      if (pattern && !pattern.test(val)) return fail(ctx, path, 'has an invalid format');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return fail(ctx, path, 'must be a valid email');
      return val;
    });
  },

  number({ min, max, int = false } = {}) {
    return new Schema('number', (val, path, ctx) => {
      if (typeof val === 'string' && ctx.coerce && val.trim() !== '') val = Number(val);
      if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) return fail(ctx, path, 'must be a number');
      if (int && !Number.isInteger(val)) return fail(ctx, path, 'must be an integer');
      if (min != null && val < min) return fail(ctx, path, `must be >= ${min}`);
      if (max != null && val > max) return fail(ctx, path, `must be <= ${max}`);
      return val;
    });
  },

  boolean() {
    return new Schema('boolean', (val, path, ctx) => {
      if (typeof val === 'boolean') return val;
      if (ctx.coerce && (val === 'true' || val === '1' || val === 'on')) return true;
      if (ctx.coerce && (val === 'false' || val === '0' || val === 'off')) return false;
      return fail(ctx, path, 'must be a boolean');
    });
  },

  enum(values) {
    return new Schema('enum', (val, path, ctx) =>
      values.includes(val) ? val : fail(ctx, path, `must be one of: ${values.join(', ')}`),
    );
  },

  array(item, { min, max } = {}) {
    return new Schema('array', (val, path, ctx) => {
      if (!Array.isArray(val)) {
        if (ctx.coerce) val = [val]; // ?tag=a  →  ['a']
        else return fail(ctx, path, 'must be an array');
      }
      if (min != null && val.length < min) return fail(ctx, path, `must have at least ${min} item${min === 1 ? '' : 's'}`);
      if (max != null && val.length > max) return fail(ctx, path, `must have at most ${max} item${max === 1 ? '' : 's'}`);
      return val.map((x, i) => item._run(x, `${path}[${i}]`, ctx));
    });
  },

  object(shape, { strict = false } = {}) {
    return new Schema('object', (val, path, ctx) => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) return fail(ctx, path, 'must be an object');
      const out = {};
      for (const key of Object.keys(shape)) {
        const r = shape[key]._run(val[key], path ? `${path}.${key}` : key, ctx);
        if (r !== undefined) out[key] = r;
      }
      if (strict) {
        for (const key of Object.keys(val)) {
          if (!(key in shape)) ctx.errors.push({ path: path ? `${path}.${key}` : key, message: 'is not allowed' });
        }
      }
      return out; // unknown keys are dropped
    });
  },

  any() {
    return new Schema('any', (val) => val);
  },

  literal(expected) {
    return new Schema('literal', (val, path, ctx) =>
      val === expected ? val : fail(ctx, path, `must be ${JSON.stringify(expected)}`),
    );
  },

  /** First schema that accepts the value wins: v.union([v.string(), v.number()]) */
  union(options) {
    return new Schema('union', (val, path, ctx) => {
      for (const opt of options) {
        const sub = { coerce: ctx.coerce, errors: [] };
        const out = opt._run(val, path, sub);
        if (!sub.errors.length) return out;
      }
      return fail(ctx, path, 'does not match any allowed type');
    });
  },

  /** Object with arbitrary keys: v.record(v.number()) */
  record(item) {
    return new Schema('record', (val, path, ctx) => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) return fail(ctx, path, 'must be an object');
      const out = {};
      for (const key of Object.keys(val)) {
        if (key === '__proto__') continue;
        const r = item._run(val[key], path ? `${path}.${key}` : key, ctx);
        if (r !== undefined) out[key] = r;
      }
      return out;
    });
  },

  /** Fixed-length list with a schema per position: v.tuple([v.number(), v.string()]) */
  tuple(items) {
    return new Schema('tuple', (val, path, ctx) => {
      if (!Array.isArray(val)) return fail(ctx, path, 'must be an array');
      if (val.length !== items.length) return fail(ctx, path, `must have exactly ${items.length} items`);
      return items.map((s, i) => s._run(val[i], `${path}[${i}]`, ctx));
    });
  },

  /** ISO date string / timestamp / Date → Date. */
  date({ min, max } = {}) {
    return new Schema('date', (val, path, ctx) => {
      const d = val instanceof Date ? val : typeof val === 'string' || typeof val === 'number' ? new Date(val) : null;
      if (!d || Number.isNaN(d.getTime())) return fail(ctx, path, 'must be a valid date');
      if (min != null && d < new Date(min)) return fail(ctx, path, `must be on or after ${new Date(min).toISOString()}`);
      if (max != null && d > new Date(max)) return fail(ctx, path, `must be on or before ${new Date(max).toISOString()}`);
      return d;
    });
  },

  /** http(s) URL (override with { protocols: ['https:'] }). */
  url({ protocols = ['http:', 'https:'] } = {}) {
    return new Schema('url', (val, path, ctx) => {
      if (typeof val !== 'string') return fail(ctx, path, 'must be a string');
      try {
        const u = new URL(val);
        if (!protocols.includes(u.protocol)) return fail(ctx, path, `must use ${protocols.join(' or ')}`);
        return val;
      } catch {
        return fail(ctx, path, 'must be a valid URL');
      }
    });
  },

  uuid() {
    return new Schema('uuid', (val, path, ctx) =>
      typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val)
        ? val
        : fail(ctx, path, 'must be a valid UUID'),
    );
  },
};

/**
 * Validation middleware. Failures → 422 { error, details: [{ path, message }] }.
 *   app.post('/users', validate({ body: v.object({ name: v.string() }) }), (c) => c.valid.body)
 * query/params values are coerced from strings (?page=2 → 2).
 */
export function validate(schemas) {
  return async (c, next) => {
    const errors = [];
    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;
      const input = source === 'body' ? await c.body() : c[source];
      const r = schema.safeParse(input, { coerce: source !== 'body' });
      if (r.ok) c.valid[source] = r.value;
      else for (const e of r.errors) errors.push({ ...e, path: e.path ? `${source}.${e.path}` : source });
    }
    if (errors.length) throw new HttpError(422, 'Validation failed', errors);
    return next();
  };
}
