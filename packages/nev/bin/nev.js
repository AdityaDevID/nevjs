import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  console.error('\nnev: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
