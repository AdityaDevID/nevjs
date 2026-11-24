// NevF.js — form state with validation.

import { signal, batch, untrack } from './reactive.js';

/**
 * const form = createForm({
 *   initial: { email: '', age: '' },
 *   validate: (values) => ({ email: values.email.includes('@') ? '' : 'Invalid email' }),   // function → { field: message }
 *   // …or any schema with safeParse() → { ok, errors: [{ path, message }] }, e.g. NevB's  v.object({...})
 *   onSubmit: async (values) => { await save(values) },
 * })
 *
 * h('form', { onSubmit: form.submit },
 *   h('input', form.field('email')),                // { name, value, onInput, onBlur }
 *   () => form.touched().email && form.errors().email,
 *   h('button', { disabled: form.submitting }, 'Save'))
 *
 * form.values()  form.errors()  form.touched()  form.valid()  form.dirty()  form.submitting()  form.submitError()
 * form.set('email', 'x')  form.reset()  form.validateAll()
 */
export function createForm(options = {}) {
  const initial = { ...(options.initial ?? {}) };
  const values = signal({ ...initial });
  const errors = signal({});
  const touched = signal({});
  const submitting = signal(false);
  const submitError = signal(null);
  const submitCount = signal(0);

  const run = (vals) => {
    const v = options.validate;
    if (!v) return {};
    if (typeof v === 'function') {
      const out = v(vals) ?? {};
      return Object.fromEntries(Object.entries(out).filter(([, m]) => m));
    }
    if (typeof v.safeParse === 'function') {
      const r = v.safeParse(vals, { coerce: false });
      const out = {};
      if (!r.ok) for (const e of r.errors) out[e.path.split('.')[0] || '_'] ??= e.message;
      return out;
    }
    return {};
  };

  const validateAll = () => {
    const e = run(values.peek());
    errors.set(e);
    return Object.keys(e).length === 0;
  };

  const set = (name, value) =>
    batch(() => {
      values.set({ ...values.peek(), [name]: value });
      if (options.validateOnChange !== false) errors.set(run(values.peek()));
    });

  const form = {
    values,
    errors,
    touched,
    submitting,
    submitError,
    submitCount,
    set,
    validateAll,
    valid: () => Object.keys(run(values())).length === 0,
    dirty: () => {
      const cur = values();
      return Object.keys({ ...initial, ...cur }).some((k) => !Object.is(cur[k], initial[k]));
    },
    reset() {
      batch(() => {
        values.set({ ...initial });
        errors.set({});
        touched.set({});
        submitError.set(null);
        submitCount.set(0);
      });
    },
    /** Spread onto an <input>/<textarea>/<select>. For checkboxes use { type: 'checkbox' } as the 2nd argument. */
    field(name, { type } = {}) {
      const isCheck = type === 'checkbox';
      const props = {
        name,
        onInput: (e) => set(name, isCheck ? e.target.checked : e.target.type === 'number' ? e.target.valueAsNumber : e.target.value),
        onBlur: () => touched.set({ ...touched.peek(), [name]: true }),
      };
      if (isCheck) {
        props.type = 'checkbox';
        props.checked = () => !!values()[name];
      } else props.value = () => values()[name] ?? '';
      return props;
    },
    /** Use as <form onSubmit={form.submit}>. Validates, marks every field touched, then calls onSubmit(values). */
    async submit(event) {
      event?.preventDefault?.();
      if (untrack(() => submitting())) return false;
      batch(() => {
        touched.set(Object.fromEntries(Object.keys({ ...initial, ...values.peek() }).map((k) => [k, true])));
        submitCount.update((n) => n + 1);
        submitError.set(null);
      });
      if (!validateAll()) return false;
      submitting.set(true);
      try {
        await options.onSubmit?.({ ...values.peek() });
        return true;
      } catch (err) {
        submitError.set(err);
        return false;
      } finally {
        submitting.set(false);
      }
    },
  };
  return form;
}
