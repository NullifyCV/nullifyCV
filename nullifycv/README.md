# NullifyCV

**Privacy-first CV redaction. Files never leave your browser.**

> Your CV. Your browser. Nobody else's business.

[![Live site](https://img.shields.io/badge/live-nullifycv.com-1e4d35?style=flat-square)](https://nullifycv.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-7aaa8a?style=flat-square)](LICENSE)
[![Processing: Client-side only](https://img.shields.io/badge/processing-client--side%20only-a8c5b0?style=flat-square)](#privacy-architecture)
[![Security Headers: A](https://img.shields.io/badge/security%20headers-A-2d6b4a?style=flat-square)](https://securityheaders.com/?q=nullifycv.com)
[![No third-party fingerprinting](https://img.shields.io/badge/no-fingerprinting-7aaa8a?style=flat-square)](https://nullifycv.com/privacy.html)

[**Try it now →**](https://nullifycv.com) · [About](https://nullifycv.com/about.html) · [Pricing](https://nullifycv.com/pro.html) · [Blog](https://nullifycv.com/blog/)

---

## What it does

NullifyCV removes personally identifiable information (PII) and bias signals from CVs and resumes — name, photo, contact details, date of birth, graduation year, school names, and more — entirely inside your browser.

**The unusual part:** files are never uploaded. There is no backend that can receive your documents. Processing happens in browser memory using [pdf.js](https://mozilla.github.io/pdf.js/), [pdf-lib](https://pdf-lib.js.org/), and [mammoth.js](https://github.com/mwilliamson/mammoth.js). You can verify this by opening DevTools → Network tab during processing — you will see zero outbound requests containing file data.

This isn't a privacy claim in a policy. It's an architectural fact you can audit, both in this repository and in your browser.

---

## Why open source matters here

A privacy claim from a closed-source SaaS is "trust us." A privacy claim from an open-source client-side tool is "here's the code, run it yourself, watch the network tab."

The entire processing pipeline is in this repository. Every line that touches your file is auditable. If you don't trust nullifycv.com, you can clone the repo and run the tool locally with no internet connection — it works exactly the same.

This is the difference between marketed privacy and verifiable privacy.

---

## Who it's for

- **Recruiters and HR teams** running structured blind hiring or preparing client-ready CV submissions
- **Compliance and DPO teams** documenting GDPR Art. 5(1)(c) data minimisation workflows
- **Job seekers** removing personal details before sharing their CV with agencies, job boards, or unknown employers
- **Staffing agencies** protecting candidate contact details when submitting CVs to clients

---

## Features

### Redaction modes

| Mode | Removes |
|---|---|
| **Standard PII** | Name, email, phone, address, postcode, graduation year |
| **Bias Strip** | Standard PII + school names, gender pronouns, LinkedIn URLs, **embedded photos** |
| **Client Submission** | Name, contact details, URLs, file metadata, **embedded photos** |
| **EEOC Blind Review** | All of the above + full demographic signal removal, **embedded photos** |

### Photo redaction (PDFs)

CVs that include a profile photo (common in Dutch, German, French, and Spanish formats) get the photo blacked out automatically in any mode that includes the `photos` flag. Detection works by walking the PDF operator list and locating image XObjects, then drawing solid black rectangles over their bounding boxes via pdf-lib.

If a PDF contains a photo and the user is in Standard mode (where photos are kept by design), a yellow warning banner appears explaining how to remove it.

### PII patterns detected

| Type | Examples | Notes |
|---|---|---|
| Full name | First-line detection | High confidence |
| Email | any@email.com | Standard regex |
| Phone | +31 6 12345678 · +1 (415) 555-0192 | Multi-format including Dutch 06 |
| Postcode | 94117 (US) · 1234 AB (NL) | Country-specific regex |
| Address | 123 Main St · Dorpsstraat 12 | Street keyword detection |
| City | Amsterdam · San Francisco, CA | 30+ NL cities + US patterns |
| Graduation year | "Class of 2009" · "Graduated May 2011" | Configurable as bias signal |
| School name | Stanford University · Universiteit van Amsterdam | EEOC mode |
| LinkedIn / URL | linkedin.com/in/x · personal websites | Optional |
| Pronouns | He/Him · zij/haar | EU + EN |
| Date of birth | NL: "geboortedatum" + date | Field-label detection |
| BSN | Dutch national ID | Length-validated regex |
| Profile photos | Embedded JPEG/PNG XObjects | Bias/Client/EEOC modes |

### Internationalization

The site has dedicated SEO landing pages for the markets where the tool is most relevant: 🇳🇱 Netherlands, 🇩🇪 Germany, 🇫🇷 France, 🇪🇸 Spain, 🇬🇧 UK, 🇨🇦 Canada, 🇰🇷 South Korea, 🇸🇪 Sweden, 🇫🇮 Finland, plus US English. Each page reflects local terminology (CV vs résumé), regulation (GDPR vs PIPEDA vs PIPA), and cultural context (Korean photo norms, Dutch BSN, German DSB).

### Output format (PDF)

For PDFs with a text layer, NullifyCV draws solid black redaction bars directly over PII positions on the **original file** — preserving layout, fonts, and formatting. The output looks identical to the input except for the black bars over redacted content.

DOCX files are extracted to plain text, redacted, and output as redacted plain text. (DOCX-to-DOCX preservation is on the roadmap.)

### Audit log

Every processed file produces a downloadable JSON audit log documenting:
- Tool version and report ID
- Timestamp
- File name and size
- Number of items redacted (broken down by type)
- Number of images redacted
- Active redaction mode and keys
- Confirmation: 0 server transmissions

Suitable for attaching to GDPR Records of Processing Activities or EEOC compliance documentation.

---

## Privacy architecture

| Component | Technology | Privacy implication |
|---|---|---|
| PDF text + image extraction | pdf.js 3.11.174 | Reads file in browser memory only |
| PDF redaction | pdf-lib 1.17.1 | Draws bars on original bytes; never transmitted |
| DOCX extraction | mammoth 1.6.0 | Pure JS, text in JS heap only |
| Hosting | Vercel CDN (static files) | No server-side code path exists for file data |
| Output | Blob URL, revoked after download | Local file transfer only |
| External scripts | SRI hashes on every CDN script | Tampered libraries blocked by browser |
| Headers | CSP, HSTS, X-Frame-Options, Referrer-Policy | A rating on [Security Headers](https://securityheaders.com/?q=nullifycv.com) |

**0 bytes of document data are ever transmitted to any server.**

### How to verify

1. Open DevTools (F12) → Network tab
2. Drop a file onto NullifyCV and process it
3. Filter by `Fetch/XHR` — observe zero outbound requests containing document data
4. Or read the source. Start with [`app.js`](nullifycv/app.js) — the entire processing pipeline.

---

## Compliance support

NullifyCV supports the following data protection and equal-opportunity standards. Note: this is a tool that supports compliant workflows — it does not determine legal compliance on its own.

| Standard | Provision | How NullifyCV supports it |
|---|---|---|
| GDPR | Art. 5(1)(c) — Data minimisation | Removes non-essential PII before internal distribution |
| GDPR | Art. 5(1)(b) — Purpose limitation | Anonymised copy limits data to assessment scope |
| GDPR | Art. 17 — Right to erasure | Panel holds no personal data; single point of deletion |
| GDPR | Art. 4(8) — Data processor | NullifyCV is **not** a processor; no DPA required |
| UK GDPR | Art. 5(1)(c) | Same as GDPR |
| CCPA / CPRA | §1798.121 | Removes zip codes and precise location |
| PIPEDA | Data minimisation principle | Same approach as GDPR |
| PIPA (KR) | Personal Information Protection Act | Removes name, photo, age proxies |
| IL BIPA | §15 — Biometric data | Profile photos removed in Bias / Client / EEOC modes |
| EEOC / Title VII | Blind review | Removes name, location, demographic signals |
| ADEA | Age discrimination | Removes graduation years and age proxies |
| NYC Local Law 144 | Bias audit documentation | Audit log supports documented blind review |

Always consult your DPO or legal counsel for formal compliance assessment.

---

## Tech stack

- **No build step.** Pure HTML, CSS, vanilla JavaScript.
- **PDF processing**: [pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174 (Mozilla)
- **PDF authoring**: [pdf-lib](https://pdf-lib.js.org/) 1.17.1
- **DOCX extraction**: [mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.6.0
- **ZIP packaging** (batch mode): [JSZip](https://stuk.github.io/jszip/) 3.10.1
- **Hosting**: [Vercel](https://vercel.com) (static files only)
- **Payments**: [Stripe](https://stripe.com) Payment Links (no card data ever touches NullifyCV)
- **Analytics**: [Vercel Web Analytics](https://vercel.com/docs/analytics) (cookie-free, GDPR-friendly)

---

## Getting started

Static site — no build step required.

```bash
git clone https://github.com/NullifyCV/nullifyCV.git
cd nullifyCV/nullifycv

# Serve locally — pick one
python -m http.server 8080
# or
npx serve .
```

Open `http://localhost:8080` in your browser. The tool runs offline once the page is loaded — you can disconnect from the internet at this point and it will still work.

---

## Project structure

```
nullifycv/
├── index.html              # Main tool / homepage
├── about.html              # How it works (with FAQ + demo)
├── pro.html                # Pricing — Stripe payment links
├── success.html            # Post-payment licence activation
├── glossary.html           # HR privacy & blind hiring terminology
├── case-study.html         # Hypothetical implementation case study
├── privacy.html            # Privacy policy
├── terms.html              # Terms of service
│
├── nl.html · de.html · fr.html · es.html
├── uk.html · ca.html · kr.html · se.html · fi.html
├── us.html                 # International SEO landing pages
│
├── app.js                  # Processing engine — pdf.js + pdf-lib + mammoth
├── posts.js                # Blog post registry
├── style.css               # Brand stylesheet
├── llms.txt                # Plain-text site description for LLM crawlers
├── sitemap.xml
├── robots.txt
│
├── icons/                  # Favicons + PWA icons
└── blog/
    ├── index.html          # Blog listing
    ├── blog.css            # Post styles
    ├── blog_template.html  # Template for new posts
    └── *.html              # Individual posts
```

---

## Deploying

**Vercel (recommended):** connect repo, set Root Directory to `nullifycv`. No build command. Vercel handles HTTPS, CDN, and analytics out of the box.

**Cloudflare Pages:** connect repo, no build command, output directory `nullifycv`.

**Netlify:** drag `nullifycv/` folder to [app.netlify.com/drop](https://app.netlify.com/drop).

**Self-hosted:** any static file server works (nginx, Apache, Caddy). Make sure `Content-Security-Policy` headers are set if you want the same A rating as the production deployment — see [`vercel.json`](nullifycv/vercel.json) for the CSP we use.

---

## Roadmap

### Shipped ✓
- pdf.js text extraction with coordinate mapping
- pdf-lib black-bar redaction preserving original layout
- **Embedded photo detection and redaction in PDFs** (May 2026)
- Dutch CV support — 06 numbers, postcodes, cities, BSN
- Four-tier pricing (free → $4.99 Week Pass → $49 Pro → Team & Enterprise on request)
- Stripe payment integration with localStorage licence activation
- 10 international SEO landing pages
- Globe language switcher across all pages
- A-rated security headers (CSP + SRI + X-Frame-Options + Referrer-Policy + Permissions-Policy)
- llms.txt + JSON-LD structured data for LLM and search engine discoverability
- Blog infrastructure with prev/next + related posts
- Glossary of 30+ HR privacy and blind hiring terms
- Vercel custom event tracking (file uploads, processing, checkout clicks)

### In progress / planned
- Batch processing — up to 200 files at once with combined audit ZIP
- Saved redaction profiles (Pro tier)
- DPO compliance report as PDF export (Pro tier)
- DOCX-to-DOCX output preserving original formatting
- Scanned PDF support via in-browser OCR (Tesseract.js)
- Browser extension for direct CV redaction from any web page

---

## Contributing

Pull requests welcome — particularly:
- Additional language patterns (Italian, Portuguese, Polish, Japanese)
- Additional regulatory framework documentation
- PII detection improvements (false positive / false negative reports with example PDFs are very helpful)
- Accessibility improvements

Please open an issue first for significant changes.

If you find a privacy or security issue, please open a [GitHub security advisory](https://github.com/NullifyCV/nullifyCV/security/advisories) rather than a public issue.

---

## Acknowledgments

NullifyCV stands on the shoulders of:

- The Mozilla pdf.js team for making in-browser PDF processing possible
- Andrew Dillon and contributors to pdf-lib
- Michael Williamson for mammoth.js
- Stuart Knightley for JSZip
- The Vercel team for free static hosting that made this project economically viable

---

## Legal

NullifyCV is a tool that supports a data minimisation workflow consistent with GDPR Article 5 principles. It does not determine legal compliance — consult your Data Protection Officer or legal counsel for a formal assessment.

MIT License — see [LICENSE](LICENSE).
