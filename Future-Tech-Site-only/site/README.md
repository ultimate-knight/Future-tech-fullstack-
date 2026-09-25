# Future Tech School Program — Merged Website

This is your 7 separate zip exports merged into **one working site** with a
single consistent header, footer, and navigation across every page.

## How to view it
Unzip, then just double‑click `index.html` (or open it in a browser).
No build step, no server, no `npm install` needed — every page pulls
Bootstrap 5 and Bootstrap Icons from a CDN, so it works straight out of the folder.

## Structure
```
site/
├── index.html                  <- Home
├── about.html
├── projects.html                (+ projects-aiml / -robotics / -web / -more)
├── programs.html                 <- overview
│   ├── programs-level1.html      + curriculum-level1.html
│   ├── programs-level2.html      + curriculum-level2.html
│   ├── programs-level3.html      + curriculum-level3.html
│   └── programs-level4.html      + curriculum-level4.html
├── methodology.html
├── school.html
├── events-workshops.html
├── competitions.html
├── gallery.html
├── certifications.html
├── admissions-individual.html
├── admissions-bulk.html
├── partnership.html
├── faq.html
├── contact.html
└── assets/
    ├── css/site.css             <- shared header/footer/nav styles
    └── images/<section>/        <- all images, grouped by which zip they came from
```

## What was changed from your originals
- Merged 7 separate projects into one, with one shared nav + footer instead
  of 7 slightly different ones.
- Removed the various `node_modules` folders (Bootstrap etc.) and switched
  every page to load Bootstrap from a CDN instead — smaller, no install step.
- Fixed a number of broken bits found in the source files: dead/incorrect
  links (e.g. the "Bulk" admissions link pointed at a page that didn't
  exist), a couple of duplicated header/footer blocks, an unclosed tag,
  a missing `</body>`, and stray whitespace in a few image paths.
- Dropped a handful of files that were empty placeholders / exact duplicates
  (`sample.html`, `home1.html`, the stub `bulk.html`, `sp.html`, `curriculum2.html`).

## If you want to keep developing it
Everything is plain HTML/CSS/Bootstrap — no framework, so you can edit any
page directly. The nav and footer are duplicated across all 27 pages (kept
that way on purpose, matching your original approach, so it stays a simple
static site with no build tooling) — if you add a new page, copy the
`<header>`/`<footer>` block from any existing page and update the link list.
