# Assets Inventory

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Developers, designers  
> **Document Status:** Complete

---

## 1. Background Artwork & Theme Assets

Midnight Stories includes **15 background theme assets** stored in `public/images/`. The checklist below highlights file format optimization recommendations:

| Filename | Purpose / Location | File Size | Format | Alt Text Audit Status | Recommended Action | Estimated Savings |
|---|---|---|---|---|---|---|
| `home_theme_bg.png` | Home Page Background | 1,051 KB | PNG | Present via decorative `aria-hidden` | Convert to WebP / AVIF | ~680 KB (-65%) |
| `about_page_bg_1785635971812.png` | About & Legal Pages Background | 913 KB | PNG | Present via decorative `aria-hidden` | Convert to WebP / AVIF | ~590 KB (-65%) |
| `auth_theme_bg.png` | Auth Pages Fallback | 510 KB | PNG | Decorative background | Convert to WebP / AVIF | ~330 KB (-65%) |
| `login_theme_bg.png` | Login Page Background | 987 KB | PNG | Decorative background | Convert to WebP / AVIF | ~640 KB (-65%) |
| `signup_theme_bg.png` | Sign Up Page Background | 908 KB | PNG | Decorative background | Convert to WebP / AVIF | ~590 KB (-65%) |
| `books_theme_bg.png` | Book Catalog Background | 927 KB | PNG | Decorative background | Convert to WebP / AVIF | ~600 KB (-65%) |
| `library_page_bg_1785636028634.png` | User Library Background | 1,156 KB | PNG | Decorative background | Convert to WebP / AVIF | ~750 KB (-65%) |
| `reader_page_bg_1785635981060.png` | Book Reader Background | 742 KB | PNG | Decorative background | Convert to WebP / AVIF | ~480 KB (-65%) |
| `stories_page_bg_1785635941629.png` | Story Feed Background | 964 KB | PNG | Decorative background | Convert to WebP / AVIF | ~620 KB (-65%) |
| `story_page_bg_1785635998903.png` | Single Story Background | 952 KB | PNG | Decorative background | Convert to WebP / AVIF | ~620 KB (-65%) |
| `profile_page_bg_1785636037845.png` | User Profile Background | 985 KB | PNG | Decorative background | Convert to WebP / AVIF | ~640 KB (-65%) |
| `resources_page_bg_1785635950351.png` | Resources Background | 1,016 KB | PNG | Decorative background | Convert to WebP / AVIF | ~660 KB (-65%) |
| `support_page_bg_1785636054161.png` | Support & Chat Background | 760 KB | PNG | Decorative background | Convert to WebP / AVIF | ~490 KB (-65%) |
| `upload_page_bg_1785636009900.png` | Upload Pages Background | 829 KB | PNG | Decorative background | Convert to WebP / AVIF | ~540 KB (-65%) |
| `default-cover.svg` | Default Book Cover Fallback | 1.3 KB | SVG | Explicit `alt="Book Cover"` | Keep SVG Vector Format | N/A (Optimal) |

### Asset Optimization Totals
* **Total Background Asset Footprint:** ~13.7 MB  
* **Potential Footprint with WebP/AVIF Conversion:** ~4.8 MB  
* **Estimated Savings:** **~8.9 MB (-65%)**

---

## 2. Layout Scripts & Stylesheets Directory

### 2.1 CSS Layout Files (`public/css/`)
* `style.css` (120 KB): Global layout styles, base cards, light/dark mode variables, and mobile header menus.
* `admin.css` (49 KB): Layout configurations for the admin stats panel, user/story roster tables, and settings tabs.
* `reader.css` (15 KB): ePUB reader-mode style rules, margins, and settings panel.

### 2.2 Client JS Files (`public/js/`)
* `app.js` (34 KB): Global setups, theme controllers, Google OAuth callback validation, and toast notification popups.
* `admin.js` (273 KB): Controls admin tab switches, data refreshes, and content moderation approval commands.
* `books.js` (22 KB): Controls public library searching, cover layout rendering, and book category filters.
* `feed.js` (7 KB): Manages recent story cards display and category filters on the home landing page.
* `library.js` (13 KB): Directs personal bookshelf bookmarks, reads stats, and reading history lists.
* `reader.js` (40 KB): Controls ePUB parser chapter flips, text sizes, and reading progress updates.
* `stories.js` (6 KB): Controls query search filters and story list updates on `stories.html`.
* `story.js` (17 KB): Connects comment feeds, bookmark commands, upvote likes, and report modals on story pages.
* `submit.js` (9 KB): Scans inputs in real-time for email/phone patterns, checks self-harm keywords, and posts submissions.
* `support.js` (24 KB): Controls ticket submissions, file uploads, and live agent chat messages.
