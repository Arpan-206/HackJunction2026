import { createElement, type ReactNode } from 'react';
import Reconciler from 'react-reconciler';

/**
 * A renderer with no host at all, for counting renders and checking hook output in the node test environment (there is
 * no DOM here). Legacy mode, so every update renders synchronously; effects are flushed after each render.
 */
const noop = () => {};
const reconciler = Reconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,
  createInstance: () => ({}),
  createTextInstance: () => ({}),
  appendInitialChild: noop,
  appendChild: noop,
  appendChildToContainer: noop,
  insertBefore: noop,
  insertInContainerBefore: noop,
  removeChild: noop,
  removeChildFromContainer: noop,
  finalizeInitialChildren: () => false,
  prepareUpdate: () => null,
  commitUpdate: noop,
  commitTextUpdate: noop,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: () => ({}),
  getPublicInstance: (i: unknown) => i,
  prepareForCommit: () => null,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  clearContainer: noop,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  getCurrentEventPriority: () => 16,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  detachDeletedInstance: noop,
} as never);

export interface Mounted {
  update: (node: ReactNode) => void;
  unmount: () => void;
}

/** Mounts `node` synchronously and runs its effects. */
export function mount(node: ReactNode): Mounted {
  const root = reconciler.createContainer({}, 0, null, false, null, '', console.error, null);
  const render = (n: ReactNode) => {
    reconciler.updateContainer(n, root, null, null);
    reconciler.flushPassiveEffects();
  };
  render(node);
  return { update: render, unmount: () => render(null) };
}

/** Renders `use` in a component; `renders` counts its renders and `result` is the latest return value. */
export function renderHook<T>(use: () => T): { result: () => T; renders: () => number; rerender: () => void; unmount: () => void } {
  let renders = 0;
  let value: T;
  function Probe() {
    renders += 1;
    value = use();
    return null;
  }
  const m = mount(createElement(Probe));
  return { result: () => value, renders: () => renders, rerender: () => m.update(createElement(Probe)), unmount: m.unmount };
}
