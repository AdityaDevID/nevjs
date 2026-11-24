import { v, validate, rateLimit } from '@adityadevid/nevjs';
import { listEntries, addEntry } from '../lib/guestbook.server.js';

export const middleware = [rateLimit({ windowMs: 60_000, max: 60 })];

export const get = () => ({ entries: listEntries() });

const check = validate({
  body: v.object({
    name: v.string({ min: 1, max: 40, trim: true }),
    message: v.string({ min: 1, max: 280, trim: true }),
  }),
});

export const post = [check, (c) => c.json({ entry: addEntry(c.valid.body) }, 201)];
