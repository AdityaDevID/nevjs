const entries = [{ id: 1, name: 'Nev', message: 'Welcome to the guestbook!', at: new Date(0).toISOString() }];
let nextId = 2;

export const listEntries = () => [...entries].reverse();

export function addEntry({ name, message }) {
  const entry = { id: nextId++, name, message, at: new Date().toISOString() };
  entries.push(entry);
  if (entries.length > 100) entries.shift();
  return entry;
}
