import { listPosts } from '../../lib/posts.server.js';

// Runs on the server for the first page load AND for client-side navigations
// (the browser asks for the result as JSON). Return anything JSON-serialisable.
export function load() {
  return { posts: listPosts() };
}
