import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '../../../components/ui';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wide layout for the stage and recorder side by side. */
  wide?: boolean;
}

/** A modal dialog: Escape closes, focus moves in and returns to the opener, Tab stays inside. */
export function Modal({ title, onClose, children, wide }: ModalProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box0 = box.current;
    box0?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box0) return;
      const items = Array.from(box0.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select, textarea')).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="mst-modal" role="presentation">
      <div ref={box} className={`mst-modal__box ${wide ? 'mst-modal__box--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="mst-modal__head">
          <h2 id={id}>{title}</h2>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}
