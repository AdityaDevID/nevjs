import { HttpError } from '@adityadevid/nevjs';
import { findPost } from '../../lib/posts.server.js';

export function load(c) {
  const post = findPost(c.params.slug);
  if (!post) throw new HttpError(404);
  return { post };
}
