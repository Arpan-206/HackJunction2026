import { useCallback, useEffect, useRef, useState } from 'react';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import { previewStep, type SkillView } from './catalogue';
import { SkillLive } from './SkillScene';
import { TheatreShowcase } from './SkillShowcase';

/** How long the preview takes to fade back to the still after the pointer leaves (matches .sk-card__live in skills.css). */
export const PREVIEW_FADE_MS = 320;

/**
 * Keeps a hover preview mounted for its fade-out: `on` turns it on at once; off, it stays mounted while it fades and
 * unmounts after. Only the hovered card ever holds a live canvas, so the grid stays four plain pictures otherwise.
 */
export function useLinger(on: boolean, ms = PREVIEW_FADE_MS): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(on);
  useEffect(() => {
    if (on) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return { mounted: on || mounted, shown: on };
}

/**
 * A skill card's hover preview: the card's own first-person scene, playing the lesson previewStep picks (the expert's
 * recording when there is one, otherwise its guide motion). Shadow puppets play in the lamplit theatre instead.
 */
export function SkillPreview({ skill, shown }: { skill: SkillView; shown: boolean }) {
  const step = previewStep(skill);
  const { track } = useReferenceTrack(step);
  const startedAt = useRef(performance.now());
  const getFrame = useCallback(() => track?.handAt((performance.now() - startedAt.current) / 1000) ?? null, [track]);
  if (!step) return null;
  const cls = `sk-card__live${shown ? ' is-on' : ''}`;
  if (skill.id === 'shadow_puppets') {
    return (
      <div className={cls} aria-hidden="true">
        <TheatreShowcase step={step} getFrame={getFrame} named={false} />
      </div>
    );
  }
  return (
    <div className={cls} aria-hidden="true">
      <SkillLive scene={skill.scene ?? 'letter'} side={stepSide(step)} getFrame={getFrame} label="" />
    </div>
  );
}
