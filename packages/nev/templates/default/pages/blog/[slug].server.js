import { HttpError } from 'nevjs';
import { findPost } from '../../lib/posts.server.js';

export function load(c) {
  const post = findPost(c.params.slug);
  if (!post) throw new HttpError(404); // shows the 404 page with a real 404 status
  return { post };
}
