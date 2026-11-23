import { v, validate } from '@adityadevid/nevjs';
import { todos, nextId } from '../../lib/todos.server.js';

export const get = () => ({ todos });

export const post = [
  validate({ body: v.object({ title: v.string({ min: 1, max: 120, trim: true }) }) }),
  (c) => {
    const todo = { id: nextId(), title: c.valid.body.title, done: false };
    todos.push(todo);
    return c.json(todo, 201);
  },
];
