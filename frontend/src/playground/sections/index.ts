import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { TokensSection } from './TokensSection';
import { ButtonsSection, CardSection, CountdownSection, FieldsSection, HeaderSection, RecordSection, StepperSection, TabsSection, ToastSection } from './UiSections';

export interface SectionDef {
  id: string;
  label: string;
  group: 'Foundations' | 'Components' | '3D';
  Component: ComponentType | LazyExoticComponent<ComponentType>;
}

/** Playground sections in navigation order. The 3D ones are lazy so the flat sections never load three.js. */
export const SECTIONS: SectionDef[] = [
  { id: 'tokens', label: 'Typography and colour', group: 'Foundations', Component: TokensSection },
  { id: 'buttons', label: 'Buttons', group: 'Components', Component: ButtonsSection },
  { id: 'fields', label: 'Fields', group: 'Components', Component: FieldsSection },
  { id: 'tabs', label: 'Tabs', group: 'Components', Component: TabsSection },
  { id: 'stepper', label: 'Stepper', group: 'Components', Component: StepperSection },
  { id: 'countdown', label: 'Countdown', group: 'Components', Component: CountdownSection },
  { id: 'record', label: 'Record button', group: 'Components', Component: RecordSection },
  { id: 'toast', label: 'Toast', group: 'Components', Component: ToastSection },
  { id: 'card', label: 'Card', group: 'Components', Component: CardSection },
  { id: 'header', label: 'Page header', group: 'Components', Component: HeaderSection },
  { id: 'hand', label: 'Hand', group: '3D', Component: lazy(() => import('./HandSection')) },
  { id: 'stage', label: 'Stage and props', group: '3D', Component: lazy(() => import('./StageSection')) },
  { id: 'marionette', label: 'Marionette guidance', group: '3D', Component: lazy(() => import('./MarionetteSection')) },
];
