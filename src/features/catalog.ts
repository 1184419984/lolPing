import { strings } from '../shared/i18n';
import type { Localized, ModuleManifest } from '../shared/modules';

const text = (key: 'hydrationEnabled' | 'hydrationInterval' | 'hydrationDuration' | 'hydrationPreview' | 'hydrationTitle'): Localized =>
  ({ en: strings('en', 'win')[key], 'zh-CN': strings('zh-CN', 'win')[key] });

export const FEATURE_CATALOG: ModuleManifest[] = [{
  id: 'hydration', api: 1, name: text('hydrationEnabled'), description: text('hydrationTitle'), changes: text('hydrationTitle'),
  capabilities: ['timers', 'storage', 'overlay', 'audio'],
  settings: [
    { key: 'enabled', type: 'boolean', label: text('hydrationEnabled'), default: false },
    { key: 'intervalMin', type: 'number', label: text('hydrationInterval'), default: 30, min: 5, max: 180, step: 1 },
    { key: 'durationS', type: 'number', label: text('hydrationDuration'), default: 8, min: 3, max: 30, step: 1 },
  ],
  actions: [{ key: 'preview', label: text('hydrationPreview') }],
  texts: { hydrationTitle: text('hydrationTitle') },
}];
