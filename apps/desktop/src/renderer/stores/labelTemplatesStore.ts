import { create } from 'zustand';
import type { LabelTemplateSummary } from '@shared/types';

interface LabelTemplatesState {
  /** Server revision — bump whenever a template is saved or reloaded. */
  revision: number;
  templates: LabelTemplateSummary[];
  setTemplates: (templates: LabelTemplateSummary[]) => void;
  upsertTemplate: (template: LabelTemplateSummary) => void;
  bumpRevision: () => void;
}

export const useLabelTemplatesStore = create<LabelTemplatesState>()((set) => ({
  revision: 0,
  templates: [],
  setTemplates: (templates) =>
    set((state) => ({
      templates,
      revision: state.revision + 1,
    })),
  upsertTemplate: (template) =>
    set((state) => {
      const exists = state.templates.some((t) => t.id === template.id);
      const templates = exists
        ? state.templates.map((t) => (t.id === template.id ? template : t))
        : [...state.templates, template];
      return { templates, revision: state.revision + 1 };
    }),
  bumpRevision: () => set((state) => ({ revision: state.revision + 1 })),
}));
