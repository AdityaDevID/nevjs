import { v, validate, rateLimit } from '@adityadevid/nevjs';
import { listEntries, addEntry } from '../lib/guestbook.server.js';

// Runs before every handler in this file.
export const middleware = [rateLimit({ windowMs: 60_000, max: 60 })];

// GET /api/guestbook
export const get = () => ({ entries: listEntries() });

// POST /api/guestbook  { name, message }  → 201, or 422 with details
const check = validate({
  body: v.object({
    name: v.string({ min: 1, max: 40, trim: true }),
    message: v.string({ min: 1, max: 280, trim: true }),
  }),
});

export const post = [check, (c) => c.json({ entry: addEntry(c.valid.body) }, 201)];
