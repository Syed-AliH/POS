import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProductDefaultsState {
  defaultCategoryId: string | null;
  setDefaultCategoryId: (id: string | null) => void;
}

export const useProductDefaultsStore = create<ProductDefaultsState>()(
  persist(
    (set) => ({
      defaultCategoryId: null,
      setDefaultCategoryId: (defaultCategoryId) => set({ defaultCategoryId }),
    }),
    { name: 'pos-product-defaults' },
  ),
);

export function newProductFormDefaults(): { categoryId?: string } {
  const defaultCategoryId = useProductDefaultsStore.getState().defaultCategoryId;
  return defaultCategoryId ? { categoryId: defaultCategoryId } : {};
}
