# Gaps & Recommendations

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Project leads  
> **Document Status:** Complete

---

## 1. Identified Documentation Gaps

The platform codebase was reviewed against standard corporate documentation checklists. The following files are missing and should be created to support future scaling:

* **RAID Log:** A central spreadsheet tracking *Risks, Assumptions, Issues, and Dependencies* (e.g. tracking Cloudflare service limits).
* **Browser/Device Support Matrix:** Specifying testing benchmarks (e.g. compatible Safari, Chrome, and Firefox versions).
* **UAT (User Acceptance Testing) Sign-Off Records:** To track validation approvals before production pages deploy.
* **Content Editor Guide:** Standard instructions to help moderators manage books and taxonomies inside the admin portal.
* **Maintenance & Update Schedule:** Detailing routine D1 database backups, R2 bucket storage checks, and Node package version updates.

---

## 2. Technical Codebase Recommendations

1. **Convert Background Graphics to WebP/AVIF:** Converting the 14 background PNG files in `public/images/` to WebP/AVIF format will reduce the assets bundle footprint from ~13.7 MB to ~4.8 MB. This will save ~8.9 MB, improving page loading speeds and Largest Contentful Paint (LCP) metrics.
2. **Implement Database Transaction Batches:** Seeding actions in `schema.sql` are written as individual statements. Grouping these statements into transaction blocks will speed up initial migrations.
3. **Consolidate Dynamic Pages Routing:** Hono contains direct route bindings in `src/worker.js`. Moving page routes and API routes into separate controller modules will make the file easier to maintain.
