import type { ModelProvider } from '../../api/types';
import { modelLabel } from './providerLabel';
import './ModelLabel.css';

/** A quiet line saying who answered: "AI Assistant", "AI Assistant offline", or the model name in dev mode. */
export function ModelLabel({ provider }: { provider: ModelProvider }) {
  const text = modelLabel(provider);
  if (!text) return null;
  return (
    <span className="model-label" data-provider={provider}>
      {text}
    </span>
  );
}
