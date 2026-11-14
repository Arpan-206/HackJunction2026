import { useEffect, useState } from 'react';
import { THEMES, THEME_IDS, useTheme } from '../../theme';
import { SectionLayout, Segmented, SelectControl, SliderControl, TextControl } from '../controls';

const SWATCHES: { token: string; use: string }[] = [
  { token: '--bg', use: 'Page' },
  { token: '--surface', use: 'Cards' },
  { token: '--surface-2', use: 'Wells' },
  { token: '--text', use: 'Body text' },
  { token: '--text-2', use: 'Secondary text' },
  { token: '--line', use: 'Hairlines' },
  { token: '--accent', use: 'Primary action' },
  { token: '--accent-soft', use: 'Hover wash' },
  { token: '--gold', use: 'Mastery only' },
  { token: '--danger', use: 'Corrections only' },
  { token: '--ok', use: 'Correct' },
  { token: '--stage-bg', use: '3D stage' },
];

const FACES = ['display', 'note', 'ui'] as const;
const STEPS = ['--step--1', '--step-0', '--step-1', '--step-2', '--step-3', '--step-4'] as const;

/** Colour tokens, type scale and the live theme switch. */
export function TokensSection() {
  const { theme, setTheme } = useTheme();
  const [face, setFace] = useState<(typeof FACES)[number]>('display');
  const [step, setStep] = useState(3);
  const [text, setText] = useState('The expert guides the hand');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(SWATCHES.map((s) => [s.token, cs.getPropertyValue(s.token).trim()])));
  }, [theme]);

  const family = `var(--font-${face})`;
  const jsx = [
    `/* theme: ${theme} (document.documentElement.dataset.theme) */`,
    `font-family: ${family};`,
    `font-size: var(${STEPS[step]});`,
    ...SWATCHES.map((s) => `/* ${s.token}: ${values[s.token] ?? ''} */`),
  ].join('\n');

  return (
    <SectionLayout
      title="Typography and colour"
      blurb="Semantic tokens only. Gold marks mastery, vermilion marks corrections, and nothing else borrows them."
      jsx={jsx}
      specimen={
        <div className="pg-tokens">
          <ul className="pg-swatches">
            {SWATCHES.map((s) => (
              <li key={s.token}>
                <span className="pg-swatch" style={{ background: `var(${s.token})` }} />
                <span className="pg-swatch__name">{s.token}</span>
                <span className="pg-swatch__use">
                  {s.use} {values[s.token]}
                </span>
              </li>
            ))}
          </ul>
          <div className="pg-type">
            <p style={{ fontFamily: family, fontSize: `var(${STEPS[step]})`, margin: 0 }}>{text}</p>
            <p className="pg-type__nums" style={{ fontFamily: family }}>
              0123456789 &middot; 1:30 &middot; 18 deg
            </p>
            <p className="note">A margin note in Aldine italic.</p>
          </div>
        </div>
      }
      controls={
        <>
          <Segmented label="Theme" value={theme} options={THEME_IDS} onChange={setTheme} />
          <p className="note">{THEMES[theme].blurb}</p>
          <SelectControl label="Typeface" value={face} options={FACES} onChange={setFace} />
          <SliderControl label="Size step" value={step} min={0} max={5} onChange={setStep} format={(v) => STEPS[v]} />
          <TextControl label="Sample text" value={text} onChange={setText} />
        </>
      }
    />
  );
}
