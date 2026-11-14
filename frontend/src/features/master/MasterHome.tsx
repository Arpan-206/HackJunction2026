import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLessons, type MotionSpec } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui';
import { HandStill } from '../../three';
import { synthFrame } from '../../three/motion';
import { sceneStage, SkillSet } from '../apprentice/skills/SkillScene';
import { ASSISTANT_OFF, useAssistant } from '../shared/assistant';
import { useAllAttempts } from '../shared/practiceLog';
import { LoadFromFile } from './files/LoadFromFile';
import { SkillCard } from './home/Folios';
import { groupBySkill, lessonsLabel } from './home/shelf';
import './home/home.css';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Arrow() {
  return (
    <svg width="26" height="12" viewBox="0 0 28 14" aria-hidden="true" {...stroke}>
      <path d="M0 7h25M19 1l7 6-7 6" />
    </svg>
  );
}

/** The open hand on the scratch door, raised and ready for the first take. */
const OPEN_HAND: MotionSpec = { preset: 'hold_pose', pose: { thumb: 0.12, index: 0.04, middle: 0.04, ring: 0.08, little: 0.12 } };

/** A goose quill over a few lines of a written plan, in iron-gall ink: the Generate steps door. */
function Quill() {
  const ink = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg className="door__quill" viewBox="0 0 120 150" aria-hidden="true" {...ink}>
      {/* The vane: a long feather leaning right, its tip curling over. */}
      <path d="M40 112C34 84 46 50 70 28c10-9 22-15 32-17-1 10-6 22-13 32C74 66 58 92 40 112z" strokeWidth="1.6" fill="var(--surface)" fillOpacity="0.55" />
      {/* The shaft, from the nib to the tip. */}
      <path d="M30 132 41 111C55 82 75 50 101 12" strokeWidth="1.5" />
      {/* Barbs along both sides. */}
      <path d="M47 96 40 92M53 85 44 80M60 74 50 67M67 63 57 55M74 53 65 44M82 43 74 34M89 33 84 25M47 98l7 1M54 87l9 0M61 76l9-1M68 65l9-3M75 55l9-4M83 44l7-5" strokeWidth="0.9" opacity="0.8" />
      {/* The cut nib and its drop of ink. */}
      <path d="M41 111 30 132l-2 6 5-4 8-23" strokeWidth="1.4" />
      {/* Three lines of the plan, written in a quick hand. */}
      <path d="M14 140c4-3 7 2 11-1s6-3 9 0 7 1 10-2 6 1 9 1M60 140c3-2 6 1 9-1s5-2 8 0 6 0 9-2" strokeWidth="1.2" />
      <path d="M14 128c3-2 5 1 8-1M14 116c3-2 6 1 9-1s5-2 8 0" strokeWidth="1.1" opacity="0.75" />
    </svg>
  );
}

/** The chalk hand standing in the scratch door's arched niche, drawn once as a picture. */
function DoorHand({ motion, id, label }: { motion: MotionSpec; id: string; label: string }) {
  const frame = useMemo(() => synthFrame(motion, 0, 'right'), [motion]);
  const stage = useMemo(() => sceneStage('letter'), []);
  return (
    <HandStill className="door__still" preset="closeup" label={label} stillId={`door:${id}:${JSON.stringify(motion)}:right:chalk`} decor={false} stage={stage}>
      <SkillSet scene="letter" frame={frame} />
    </HandStill>
  );
}

interface DoorProps {
  to: string;
  title: string;
  text: string;
  cta: string;
  /** What stands in the door's arched niche. */
  art: ReactNode;
}

/** One way into the workshop: an arched niche with a drawing in it, then what lies behind the door. */
function Door({ to, title, text, cta, art }: DoorProps) {
  return (
    <article className="door">
      <Link to={to} className="door__link" aria-label={title} />
      <div className="door__niche">
        {art}
      </div>
      <div className="door__body">
        <h2 className="door__title">{title}</h2>
        <p className="door__text">{text}</p>
        <span className="door__cta">
          {cta} <Arrow />
        </span>
      </div>
    </article>
  );
}

/** Expert landing: two doors into the workshop (a new skill from scratch, or steps drafted for you), then the shelf of skills. */
export function MasterHome() {
  const { data: lessons, error, loading, reload } = useLessons();
  const [assistant] = useAssistant();
  const attempts = useAllAttempts();
  const shelf = useMemo(() => (lessons ? groupBySkill(lessons, attempts) : []), [lessons, attempts]);

  return (
    <div className="studio">
      <PageHeader title="Expert's studio" context="La bottega: record a skill once, teach it to many hands." />
      <div className="doors">
        <Door
          to="/expert/scratch"
          title="Start from scratch"
          text="Put on the gloves and record a new skill. Name it when you are happy with it."
          cta="Record a new skill"
          art={<DoorHand motion={OPEN_HAND} id="scratch" label="An open chalk hand, ready for the first take" />}
        />
        <Door
          to="/expert/generate"
          title="Generate steps"
          text={assistant ? 'Describe the skill in your own words and the AI Assistant drafts a lesson plan for you to adjust before recording.' : ASSISTANT_OFF.draft}
          cta={assistant ? 'Describe a lesson' : 'Write the steps'}
          art={<Quill />}
        />
      </div>

      <section className="shelf" aria-labelledby="shelf-title">
        <div className="shelf__head">
          <h2 id="shelf-title" className="shelf__title">
            Your skills
          </h2>
          {shelf.length > 0 && lessons && (
            <p className="shelf__count">
              {shelf.length} {shelf.length === 1 ? 'skill' : 'skills'}, {lessonsLabel(lessons.length)}, latest first
            </p>
          )}
        </div>
        {loading && <p className="note">Consulting the ledger...</p>}
        {error && (
          <div className="mst-err" role="alert">
            <p className="note">The lesson ledger could not be opened. Check that the backend is running, then try again.</p>
            <Button variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        )}
        {lessons && lessons.length === 0 && <p className="note">No lessons yet. Open a door above to make your first.</p>}
        <LoadFromFile onLoaded={reload} />
        {shelf.length > 0 && (
          <ul className="shelf__list">
            {shelf.map((s) => (
              <li key={s.key}>
                <SkillCard s={s} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
