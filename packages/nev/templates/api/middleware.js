// Runs before every page and API route. Remove or edit freely.
import { rateLimit } from 'nevjs';

export const matcher = ['/api/*'];
export default rateLimit({ windowMs: 60_000, max: 120 });
