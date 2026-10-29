// Web preview only. expo-secure-store has no browser implementation, so when the app is bundled for the
// web (used for design screenshots, never shipped) Metro resolves 'expo-secure-store' to this file,
// which keeps the same three calls on top of localStorage. The phone builds never load it.
function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
export async function getItemAsync(key) {
  const s = store();
  return s ? s.getItem(key) : null;
}
export async function setItemAsync(key, value) {
  const s = store();
  if (s) s.setItem(key, String(value));
}
export async function deleteItemAsync(key) {
  const s = store();
  if (s) s.removeItem(key);
}
export async function isAvailableAsync() { return !!store(); }
export default { getItemAsync, setItemAsync, deleteItemAsync, isAvailableAsync };
