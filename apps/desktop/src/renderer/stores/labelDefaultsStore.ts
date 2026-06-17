import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LabelDefaultsState {
  lastTemplateId: string | null;
  setLastTemplateId: (id: string | null) => void;
}

export const useLabelDefaultsStore = create<LabelDefaultsState>()(
  persist(
    (set) => ({
      lastTemplateId: null,
      setLastTemplateId: (lastTemplateId) => set({ lastTemplateId }),
    }),
    { name: 'pos-label-defaults' },
  ),
);
