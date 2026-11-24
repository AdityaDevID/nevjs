import { rateLimit } from '@adityadevid/nevjs';

export const matcher = ['/api/*'];
export default rateLimit({ windowMs: 60_000, max: 120 });
