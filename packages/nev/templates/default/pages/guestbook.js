import { h, signal, resource, For, Show, batch } from '@adityadevid/nevf';

export const head = () => ({ title: 'Guestbook' });

export default function Guestbook() {
  const list = resource(() => fetch('/api/guestbook').then((r) => r.json()));
  const name = signal('');
  const message = signal('');
  const errors = signal([]);
  const busy = signal(false);

  async function submit(e) {
    e.preventDefault();
    batch(() => {
      busy.set(true);
      errors.set([]);
    });
    try {
      const res = await fetch('/api/guestbook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name(), message: message() }),
      });
      const body = await res.json();
      if (res.status === 422) {
        errors.set(body.details.map((d) => `${d.path.replace('body.', '')} ${d.message}`));
      } else if (!res.ok) {
        errors.set([body.error ?? 'Something went wrong']);
      } else {
        message.set('');
        await list.refetch();
      }
    } catch {
      errors.set(['Network error']);
    } finally {
      busy.set(false);
    }
  }

  return h(
    'div',
    null,
    h('h1', null, 'Guestbook'),
    h(
      'form',
      { class: 'stack card', onSubmit: submit },
      h('input', { id: 'name', placeholder: 'Your name', value: name, onInput: (e) => name.set(e.target.value) }),
      h('textarea', { id: 'message', rows: 3, placeholder: 'Say something…', value: message, onInput: (e) => message.set(e.target.value) }),
      h(For, { each: errors }, (msg) => h('div', { class: 'error' }, msg)),
      h('button', { id: 'send', type: 'submit', disabled: busy }, () => (busy() ? 'Sending…' : 'Sign')),
    ),
    h(
      Show,
      { when: () => list.data(), fallback: h('p', { class: 'muted' }, 'Loading…') },
      (data) =>
        h(For, { each: data.entries }, (entry) =>
          h('div', { class: 'card entry' }, h('strong', null, entry.name), h('p', { style: { margin: '.25rem 0 0' } }, entry.message)),
        ),
    ),
  );
}
