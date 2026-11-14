import { useState } from 'react';
import type { Lesson, TestSpec } from '../../../../api';
import { Segmented } from '../../training/Segmented';
import { AirTyping } from './AirTyping';
import { KeyboardTyping } from './KeyboardTyping';

type TypingMode = 'air' | 'keys';
const MODES: { id: TypingMode; label: string }[] = [
  { id: 'air', label: 'Air typing' },
  { id: 'keys', label: 'Type on your keyboard' },
];

/** The touch typing test: air typing against the bot typist, or real keys with the gloves checking each finger. */
export function TypingTest({ spec, lesson }: { spec: TestSpec; lesson?: Lesson }) {
  const [mode, setMode] = useState<TypingMode>('air');
  return (
    <div className="ty-test">
      <Segmented label="How you type" value={mode} options={MODES} onChange={setMode} />
      {mode === 'air' ? <AirTyping spec={spec} lesson={lesson} /> : <KeyboardTyping />}
    </div>
  );
}
