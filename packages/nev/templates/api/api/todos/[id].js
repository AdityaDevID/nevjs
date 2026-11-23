import { v, validate, HttpError } from '@adityadevid/nevjs';
import { todos } from '../../lib/todos.server.js';

const find = (c) => {
  const todo = todos.find((t) => t.id === Number(c.params.id));
  if (!todo) throw new HttpError(404, 'Todo not found');
  return todo;
};

export const get = (c) => find(c);
export const patch = [
  validate({ body: v.object({ done: v.boolean().optional(), title: v.string({ min: 1, max: 120 }).optional() }) }),
  (c) => Object.assign(find(c), c.valid.body),
];
export const del = (c) => {
  todos.splice(todos.indexOf(find(c)), 1);
  return new Response(null, { status: 204 });
};
