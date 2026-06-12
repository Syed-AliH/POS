# Mama Babi POS — Design System Audit & Documentation

## 1. Design Audit Report (Pre-Refactor)

### Inconsistencies Found

| Area | Issue |
|------|--------|
| **Colors** | Pink (`pink-*`) used as brand; `brand-*` tokens defined but unused; no semantic success/warning/danger scale |
| **Typography** | Segoe UI system font; no scale; mixed `text-lg` / `text-2xl` page titles |
| **Spacing** | Ad-hoc `p-4` / `p-6` / `p-3`; no 8px system enforcement |
| **Navigation** | Horizontal top nav overflow on smaller screens; “More” hid 11 modules |
| **Tables** | Repeated inline patterns; inconsistent sticky headers and empty states |
| **Forms** | Mix of raw `<input>` and no shared label/error components |
| **Buttons** | `@mama-babi/ui` Button + raw `<button>` with duplicate styles |
| **Modals** | Custom Modal only; no shared confirmation pattern beyond `ModalActions` |
| **Cards** | `bg-white rounded-xl border` duplicated ~40+ times |
| **Icons** | None — emoji and text only |
| **Loading** | Text “Loading…” only; no spinner component |
| **Empty states** | Inline messages; no reusable empty-state component |
| **Dark mode** | Not supported |
| **Accessibility** | Missing consistent focus rings; some modals lack full a11y |

### UX Issues

- Checkout search field visually equal to secondary inputs (should dominate)
- Manager workflows scattered under “More”
- No collapsible navigation for dense modules
- Workflow hints useful but pink banner competed with content

### What Was Preserved (100%)

All APIs, IPC, business logic, calculations, permissions, routes, shortcuts (F1–F4, Alt+1–9), cart store, and workflows remain unchanged.

---

## 2. Design Philosophy

- **Simplicity & clarity** over decoration
- **Consistency** via shared tokens and components
- **Speed** especially on Checkout
- **No** gradients, glassmorphism, or heavy animation

---

## 3. Color System

| Token | Light | Usage |
|-------|-------|--------|
| Primary | Blue 600 `#2563EB` | Actions, active nav, links |
| Background | `#F8FAFC` | App shell |
| Card | White / Slate 900 (dark) | Panels, tables |
| Border | Slate 200 / 800 | Dividers |
| Text | Slate 900 / 50 | Body & headings |
| Success | Green 600 | Stock OK, completed |
| Warning | Amber 600 | Low stock, holds |
| Danger | Red 600 | Void, delete, errors |
| Info | Blue 600 | Hints, info badges |

Dark mode: `class="dark"` on `<html>`, toggled via header control (persisted).

---

## 4. Typography (Poppins)

| Role | Classes |
|------|---------|
| Page title | `text-2xl font-bold tracking-tight` |
| Section title | `text-base font-semibold` |
| Card title | `text-base font-semibold` |
| Table header | `text-xs font-semibold uppercase tracking-wide text-slate-500` |
| Form label | `text-sm font-medium` |
| Body | `text-sm` |
| Caption | `text-xs text-slate-500` |

Weights: 400, 500, 600, 700 (Google Fonts).

---

## 5. Icon System (Lucide React)

Navigation and KPI cards use Lucide icons. Icons support recognition — not decoration.

---

## 6. Layout System

- **Fixed sidebar** (collapsible, 240px / 68px)
- **Sticky header** (shortcuts, theme, user, logout)
- **Content**: `.page-shell` — scrollable, `p-6`, muted background
- **Spacing**: 8px grid (`2`, `4`, `6`, `8` Tailwind units)

---

## 7. Component Library (`@mama-babi/ui`)

| Component | Purpose |
|-----------|---------|
| `Button` | Primary / secondary / ghost / danger + loading |
| `Card`, `KpiCard` | Panels and dashboard metrics |
| `Badge` | Status chips |
| `Input` | Label, error, hint |
| `PageHeader` | Title + description + actions |
| `EmptyState` | Zero-data screens |
| `Spinner` | Loading |
| `cn()` | Tailwind merge utility |

### CSS Utilities (`styles.css`)

- `.page-shell` — page wrapper
- `.data-table`, `.data-table-wrap` — tables
- `.form-input`, `.form-select`, `.form-label` — forms

---

## 8. Navigation Map

Sidebar sections: **Operations**, **Overview**, **Catalog**, **Partners**, **Finance**, **Tools**, **Admin**.

Alt+1–9 shortcuts map to flattened nav order (unchanged behavior).

---

## 9. Implementation Status

| Area | Status |
|------|--------|
| Design tokens & Tailwind | ✅ |
| Poppins + Lucide | ✅ |
| Dark mode toggle | ✅ |
| Sidebar layout | ✅ |
| Button / Card / Input library | ✅ |
| Global pink → primary migration | ✅ |
| Login, Dashboard, More, Checkout polish | ✅ |
| All pages `.page-shell` + tables | 🔄 Incremental (use utility classes) |
| shadcn/ui full install | ⏸ Not required — CVA patterns adopted |
| Receipt / Label designers | ⏸ Visual pass recommended next |
| Charts on Reports | ⏸ Recommendation only |

---

## 10. UX Recommendations (No Logic Changes)

1. Add chart library (e.g. Recharts) to Reports for trend lines
2. Wire `PurchaseOrdersPage` to routing or remove orphan page
3. Settings: tab deep-links for “Users” sidebar entry
4. Checkout: optional compact mode for small displays
5. Table pagination component for 100+ row lists

---

## 11. Accessibility Checklist

- Focus rings on buttons/inputs (`focus-visible:ring-2`)
- Sidebar collapse button `aria-label`
- Modal `role="dialog"` / `alertdialog`
- Minimum 44px touch targets on primary actions
- Contrast: primary on white meets WCAG AA for large text

---

*Last updated: design system v1 — enterprise neutral blue palette*
