# Accessibility (A11y) Notes

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Developers, designers  
> **Document Status:** Complete

---

## 1. Accessibility Commitments

Midnight Stories aims to meet **WCAG 2.1 Level AA** guidelines. Key structural enhancements are detailed below:

* **Header Role Landmark Elements:** Pages use HTML5 structural elements (`<header>`, `<nav>`, `<main>`, `<footer>`) to help screen readers navigate page sections.
* **Input Label Associations:** Form fields on pages like `submit.html`, `login.html`, and `support.html` have associated `<label>` tags to support screen reader narration.
* **Decorative Elements Isolation:** Image backgrounds use `aria-hidden="true"` or empty `alt=""` attributes. This isolates decorative graphics from screen readers and avoids confusing users.
* **Alternative Text Checks:** Layout image elements have alternative description tags (e.g. `alt="Book Cover"`).
* **High Contrast Colors:** CSS properties enforce WCAG AA standard contrast ratios. Text colors adjust automatically when dark mode is active to preserve readability.
* **Interactive Controls Tags:** Interactive icon elements have explicit descriptive attributes (e.g. `aria-label="Toggle theme"`, `aria-label="Toggle 3D card style"`).
