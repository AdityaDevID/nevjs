import { listPosts } from '../../lib/posts.server.js';

export function load() {
  return { posts: listPosts() };
}
