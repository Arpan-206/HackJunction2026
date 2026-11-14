/** Turns a prop bag into a JSX snippet, so the playground can copy exactly what the owner tuned. */

/** A literal JSX expression, written as `name={expr}` without quoting, e.g. `expr('() => {}')`. */
export class Expr {
  constructor(readonly source: string) {}
}

/** Marks a string as raw JSX expression source. */
export const expr = (source: string): Expr => new Expr(source);

/** Formats one value as the right-hand side of a JSX attribute, or null when the prop should be left out. */
function attr(name: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Expr) return `${name}={${value.source}}`;
  if (typeof value === 'string') return `${name}=${JSON.stringify(value)}`;
  if (value === true) return name;
  if (typeof value === 'boolean' || typeof value === 'number') return `${name}={${String(value)}}`;
  const json = JSON.stringify(value, null, 1)
    .replace(/\n\s*/g, ' ')
    .replace(/"([A-Za-z_]\w*)":/g, '$1:')
    .replace(/\[ /g, '[')
    .replace(/ \]/g, ']')
    .replace(/\{ /g, '{ ')
    .replace(/,(\S)/g, ', $1');
  return `${name}={${json}}`;
}

/** Renders `<Name a="b" c />` (or with children), one attribute per line once the tag is long. Undefined props are skipped. */
export function toJsx(name: string, props: Record<string, unknown>, children?: string): string {
  const parts = Object.entries(props)
    .map(([k, v]) => attr(k, v))
    .filter((p): p is string => p !== null);
  const inline = `<${name}${parts.length ? ' ' + parts.join(' ') : ''}`;
  const long = inline.length > 72;
  const open = long ? `<${name}\n${parts.map((p) => `  ${p}`).join('\n')}\n` : inline;
  if (children === undefined) return `${open}${long ? '' : ' '}/>`;
  return `${open}>\n  ${children}\n</${name}>`;
}
