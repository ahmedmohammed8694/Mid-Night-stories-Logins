# Style Guide & Design Tokens

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Designers, content creators  
> **Document Status:** Complete

---

## 1. Design System Tokens

Midnight Stories runs on a custom CSS property token structure declared inside `public/css/style.css`. Key layout spacing, typography sizes, and border rules are detailed below:

```css
/* Typography Fonts */
--font-primary: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-display: 'Fraunces', Georgia, serif;

/* Radii Tokens */
--radius-sm: 6px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;
--radius-full: 9999px;

/* Shadow Tokens */
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.45);
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.45);
--shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.55);
--shadow-xl: 0 20px 56px rgba(0, 0, 0, 0.65);
--shadow-glow: 0 0 28px var(--page-accent-glow);
```

---

## 2. Color Palette Matrix

| Token Name | Light Mode (Warm Book Theme) | Dark Mode (Midnight Theme) | UI Role / Usage |
|---|---|---|---|
| `--ms-bg` | `#FAF6EE` (Warm Cream) | `#070914` (Deep Midnight Blue) | Global Page Background |
| `--ms-surface` | `#FFFFFF` (Pure White) | `rgba(15, 23, 42, 0.72)` (Translucent Slate) | Cards, Modals, Headers |
| `--ms-border` | `#E6DFD3` (Soft Warm Gray) | `rgba(255, 255, 255, 0.12)` (Translucent Line) | Dividers and Card Borders |
| `--ms-text` | `#1A202C` (Off-black) | `#F1EDE4` (Warm Chalk) | Heading & Primary Body Text |
| `--ms-text-secondary`| `#4A5568` (Slate Gray) | `#9CA3BE` (Muted Indigo Gray) | Metadata and Secondary Info |
| `--ms-text-muted` | `#718096` (Cool Gray) | `#6B7290` (Dark Slate Gray) | Inactive labels, Placeholders |
| `--ms-accent` | `#801D2C` (Deep Crimson) | `#F59E0B` (Candlelight Amber Gold) | Primary Buttons, Active States |
| `--accent-rose` | `#C53030` | `#F87171` | Danger state / Destructive Buttons |
| `--accent-emerald` | `#2F855A` | `#34D399` | Success state / Active verification |
| `--accent-amber` | `#C05621` | `#FBBF24` | Warning state / Pending alerts |

---

## 3. Typography Hierarchy

* **Heading Serif Font (`Fraunces`):** Assigned to story text bodies, headings (`h1`, `h2`), and book chapters to emulate a premium paper-book aesthetic.
* **UI Sans Font (`Inter`):** Assigned to functional UI cards, buttons, dashboard grids, admin panels, form fields, and navigation bars to provide clean readability.
