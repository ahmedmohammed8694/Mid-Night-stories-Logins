# Sitemap & Information Architecture (IA)

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Developers, stakeholders  
> **Document Status:** Complete

---

## 1. Hierarchical Information Architecture (Sitemap)

The Midnight Stories platform contains **27 HTML pages** organized in the folder hierarchy below:

```
public/
├── index.html (Core Experience Landing & Feed)
├── about.html (Platform Mission, Features, and Policies)
├── guidelines.html (Community Code of Conduct)
├── stories.html (Story Feed Explorer)
├── story.html (Individual Story View & Comments)
├── submit.html (Anonymous Story Editor)
├── books.html (Book Library Catalog)
├── library.html (Personal Dashboard & Bookmarks)
├── reader.html (Distraction-Free E-Reader)
├── upload-book.html (Book Contributor Tool)
├── login.html (Standard Sign-in & Google OAuth)
├── signup.html (User Registration)
├── forgot-password.html (3-Step Account Recovery)
├── profile.html (User Settings & 2FA Setup)
├── support.html (Crisis Support & Helpdesk Ticketing)
├── chat.html (Real-time Support Chat)
├── resources.html (Mental Health Helplines Directory)
├── admin.html (Administrative Console Dashboard)
├── privacy.html (Privacy Policy)
├── terms.html (Terms of Service)
├── copyright.html (DMCA & Copyright Policy)
├── disclaimer.html (Mental Health Legal Disclaimer)
├── cookie-policy.html (Strictly Necessary Cookies Policy)
├── accessibility.html (WCAG AA Compliance Statement)
├── refund-policy.html (Donation & Refund Statement)
├── hash.html (Offline bcrypt Generator Utility)
└── admin/
    └── employees.html (Employee & RBAC Roster Desk)
```

---

## 2. Page Inventory Detail

Below is the complete catalog of all 27 pages, detailing their core headings, form elements, client JS controllers, and background design assets:

| Page Path | H1 Heading / Core Purpose | Forms & Inputs | Client JS | Theme Background Asset |
|---|---|---|---|---|
| `index.html` | Share Your Story Anonymously | Quick search, category filters | `app.js`, `feed.js` | `home_theme_bg.png` |
| `about.html` | About Our Creative Writing Platform | Newsletter subscription | `app.js` | `about_page_bg_1785635971812.png` |
| `guidelines.html` | Community Safety Standards | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `stories.html` | Explore Anonymous Stories | Search input, sort/filter pills | `feed.js`, `stories.js` | `stories_page_bg_1785635941629.png` |
| `story.html` | Story Reader | Comment editor, reply boxes, report dialog | `story.js` | `story_page_bg_1785635998903.png` |
| `submit.html` | Submit Your Story | Title, story body, category, tags, cover upload | `submit.js` | `upload_page_bg_1785636009900.png` |
| `books.html` | Public Domain Book Library | Book search query, category, sort dropdown | `books.js` | `books_theme_bg.png` |
| `library.html` | My Personal Library | Library search input, shelf filters | `library.js` | `library_page_bg_1785636028634.png` |
| `reader.html` | Midnight Reader | Chapter select, font size slider, e-theme toggles | `reader.js` | `reader_page_bg_1785635981060.png` |
| `upload-book.html` | Upload New Book | Title, author, description, book file, cover file | `books.js` | `upload_page_bg_1785636009900.png` |
| `login.html` | Welcome Back | Email, password, 2FA validation token | `app.js` | `login_theme_bg.png` |
| `signup.html` | Join Midnight Stories | Full name, email, password, DOB, phone | `app.js` | `signup_theme_bg.png` |
| `forgot-password.html`| Reset Password | Step 1 email, Step 2 OTP, Step 3 new password | `app.js` | `auth_theme_bg.png` |
| `profile.html` | User Profile & Settings | Name, bio, avatar select, phone privacy, 2FA toggle | `app.js` | `profile_page_bg_1785636037845.png` |
| `support.html` | Crisis Support & Help Desk | Ticket category, priority, subject, description, file | `support.js` | `support_page_bg_1785636054161.png` |
| `chat.html` | Live Support Chat | Chat input, upload button | `support.js` | `support_page_bg_1785636054161.png` |
| `resources.html` | Crisis Support Resources | None (Interactive Helpline cards) | `app.js` | `resources_page_bg_1785635950351.png` |
| `admin.html` | Administrative Console | Login email/password/MFA, review selectors, settings | `admin.js` | N/A (Admin Surface) |
| `admin/employees.html`| Employee Management & RBAC | Provision employee modal, documents upload, status toggle | Inline JS | N/A (Admin Surface) |
| `privacy.html` | Privacy Policy | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `terms.html` | Terms of Service | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `copyright.html` | Copyright & DMCA Policy | Infringement signature, work link, description | `app.js` | `about_page_bg_1785635971812.png` |
| `disclaimer.html` | Mental Health Disclaimer | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `cookie-policy.html` | Cookie Policy | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `accessibility.html` | Accessibility Statement | Feedback name, email, and statement | `app.js` | `about_page_bg_1785635971812.png` |
| `refund-policy.html` | Refund Policy | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `hash.html` | Password Hashing Utility | String input, output bcrypt field | Inline JS | N/A (Utility) |
