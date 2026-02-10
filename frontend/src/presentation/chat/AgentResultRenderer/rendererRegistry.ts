import { type ComponentType, lazy, type LazyExoticComponent } from 'react';
import type { RendererProps } from './types';

type LazyRendererFactory = () => Promise<{ default: ComponentType<RendererProps> }>;

const registry = new Map<string, LazyExoticComponent<ComponentType<RendererProps>>>();

/**
 * Register a renderer for a specific result type.
 * Creates the lazy component immediately so it's stable across renders.
 */
export function registerRenderer(type: string, factory: LazyRendererFactory): void {
  registry.set(type, lazy(factory));
}

/**
 * Get the lazy-loaded renderer for a type.
 * Returns undefined if no renderer is registered.
 * The component reference is stable (created at registration time).
 */
export function getRenderer(type: string): LazyExoticComponent<ComponentType<RendererProps>> | undefined {
  return registry.get(type);
}

// Default registrations
registerRenderer('chart_config', () =>
  import('../ChartRenderer').then(m => ({ default: m.ChartRenderer as ComponentType<RendererProps> }))
);

registerRenderer('citation_result', () =>
  import('../CitationRenderer').then(m => ({ default: m.CitationRenderer as ComponentType<RendererProps> }))
);
