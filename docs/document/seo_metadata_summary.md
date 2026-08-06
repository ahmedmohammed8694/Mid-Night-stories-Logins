# SEO & Metadata Summary

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Technical writers, SEO specialists  
> **Document Status:** Complete

---

## 1. Search Engine Optimization (SEO) Indicators

The platform pages enforce search visibility rules through specific HTML structures:

### 1.1 Structural HTML Layout
* **Descriptive Title Tags:** Core pages have specific, unique title formats (e.g. `<title>Crisis Support, Mental Health & LGBTQ Resources | Midnight</title>`).
* **Canonical Link Tags:** Direct search engines to authoritative pages (e.g. `<link rel="canonical" href="https://midnightstories.dpdns.org/resources" />`) to prevent duplication.
* **Heading Structure Hierarchy:** Pages start with a single `<h1>` tag to define the page topic, followed by sequential `<h2>` and `<h3>` tags for subsections.
* **Page Metadata Descriptions:** Descriptive meta elements summary descriptions are defined for each cataloged view page (e.g. `<meta name="description" content="Access confidential mental health support...">`).

---

## 2. Technical Indexing Files

### 2.1 robots.txt (`public/robots.txt`)
Contains crawling rules to guide search engine bots:
```txt
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin.html
Disallow: /admin/
Disallow: /api/admin/
Sitemap: https://midnightstories.dpdns.org/sitemap.xml
```

### 2.2 sitemap.xml (`public/sitemap.xml`)
Exposes search crawlers directly to the public pages map list:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://midnightstories.dpdns.org/</loc>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/stories</loc>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/books</loc>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/resources</loc>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/about</loc>
    <priority>0.5</priority>
  </url>
</urlset>
```
*Disallows crawling of `/admin`, `/admin.html`, or `/admin/` portals to protect admin structures and user data directories.*
