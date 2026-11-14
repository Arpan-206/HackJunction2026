import { fixParts } from './logic';

/** A fix step with its commands set as code. */
export function FixText({ text }: { text: string }) {
  return (
    <>
      {fixParts(text).map((p, i) =>
        p.code ? (
          <code key={i} className="gl-code">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
