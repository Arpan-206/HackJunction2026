/**
 * Read a query flag such as `?demo=1` or `?dev=1`. The first time it is seen it is remembered for the tab, so moving between
 * pages (which drops the query string) keeps the setting.
 */
export function readFlag(name: string): boolean {
  const key = `apprentice.flag.${name}`;
  try {
    const v = new URLSearchParams(window.location.search).get(name);
    if (v === '1') {
      sessionStorage.setItem(key, '1');
      return true;
    }
    if (v === '0') {
      sessionStorage.removeItem(key);
      return false;
    }
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Demo mode: fewer clean reps to advance, and believable history seeded on the library page. */
export const isDemo = (): boolean => readFlag('demo');
/** Developer aids, such as the button that loads demo history. */
export const isDev = (): boolean => readFlag('dev');
