/* ── NullifyCV Blog Posts Registry ───────────────────────────────────────── */
/* Add new posts here — all pages read from this file automatically           */
/* Fields: slug, title, description, date, lang, category, readTime, tags    */

const BLOG_POSTS = [
  {
    slug:        'how-to-remove-pii-from-resume',
    title:       'How to Remove PII from a Resume — A Guide for Recruiters',
    description: 'Learn how to redact selected personal information from resumes for blind review using a browser-based workflow.',
    date:        '2026-05-01',
    dateLabel:   'May 2026',
    lang:        'en',
    langLabel:   'EN',
    category:    'Recruiting',
    readTime:    6,
    tags:        ['pii', 'gdpr', 'recruiting', 'blind-hiring'],
    featured:    true,
  },
  {
    slug:        'cv-anonymisation-for-recruiters',
    title:       'CV Anonymisation for Recruiters — A Practical Guide',
    description: 'Learn how to redact selected CV details for blind review, client sharing and a smaller personal-data footprint.',
    date:        '2026-05-08',
    dateLabel:   'May 2026',
    lang:        'en',
    langLabel:   'EN',
    category:    'Recruiting',
    readTime:    7,
    tags:        ['gdpr', 'cv-anonymisation', 'blind-hiring', 'recruiting'],
    featured:    false,
  },
  {
    slug:        'blind-hiring-guide-hr-teams',
    title:       'Blind Hiring Guide for HR Teams — What It Is and How to Do It',
    description: 'A practical guide to blind hiring for HR teams: what to redact, how to review the result and how to document the workflow.',
    date:        '2026-05-15',
    dateLabel:   'May 2026',
    lang:        'en',
    langLabel:   'EN',
    category:    'HR',
    readTime:    8,
    tags:        ['blind-hiring', 'eeoc', 'hr', 'structured-hiring'],
    featured:    false,
  },
  {
    slug:        'gdpr-hiring-hr-guide',
    title:       'GDPR and Hiring — What HR Teams Need to Know',
    description: 'How GDPR principles affect hiring, and where resume redaction can support a broader data-minimisation workflow.',
    date:        '2026-05-22',
    dateLabel:   'May 2026',
    lang:        'en',
    langLabel:   'EN',
    category:    'Compliance',
    readTime:    8,
    tags:        ['gdpr', 'compliance', 'hr', 'data-protection'],
    featured:    false,
  },
  {
    slug:        'redact-cv-client-submission',
    title:       'How to Redact a CV for Client Submission — A Recruiter\'s Guide',
    description: 'How to redact a candidate\'s CV before sending it to a client. Protect candidate data, prevent poaching, and stay privacy-conscious.',
    date:        '2026-05-29',
    dateLabel:   'May 2026',
    lang:        'en',
    langLabel:   'EN',
    category:    'Recruiting',
    readTime:    6,
    tags:        ['cv-redaction', 'client-submission', 'gdpr', 'recruiting'],
    featured:    false,
  },
  {
    slug:        'blind-cv-checklist',
    title:       'Blind CV Checklist for Client Submission',
    description: 'Use this recruiter checklist to remove contact details from a CV before client submission, preserve relevant experience and check the exported PDF.',
    date:        '2026-11-14',
    dateLabel:   'November 2026',
    lang:        'en',
    langLabel:   'EN',
    category:    'Recruiting',
    readTime:    2,
    tags:        ['cv-redaction', 'client-submission', 'recruiting', 'blind-hiring'],
    featured:    false,
  },
];

/* ── Helper functions used by blog index and post pages ─────────────────── */

function getPostBySlug(slug) {
  return BLOG_POSTS.find(p => p.slug === slug) || null;
}

function getRelatedPosts(currentSlug, count = 3) {
  const current = getPostBySlug(currentSlug);
  if (!current) return BLOG_POSTS.slice(0, count);
  return BLOG_POSTS
    .filter(p => p.slug !== currentSlug)
    .sort((a, b) => {
      // Score by shared tags
      const aScore = a.tags.filter(t => current.tags.includes(t)).length;
      const bScore = b.tags.filter(t => current.tags.includes(t)).length;
      return bScore - aScore;
    })
    .slice(0, count);
}

function getPrevNext(currentSlug) {
  const idx  = BLOG_POSTS.findIndex(p => p.slug === currentSlug);
  const prev = idx > 0 ? BLOG_POSTS[idx - 1] : null;
  const next = idx < BLOG_POSTS.length - 1 ? BLOG_POSTS[idx + 1] : null;
  return { prev, next };
}

function getCategoryColor(category) {
  const colors = {
    'Recruiting':  { bg: 'var(--green-bg)',  color: 'var(--green-dark)' },
    'HR':          { bg: '#e6f1fb',           color: '#185fa5' },
    'Compliance':  { bg: '#f3e8f8',           color: '#4a1f7a' },
    'Privacy':     { bg: '#fdf3e3',           color: '#7a5000' },
  };
  return colors[category] || colors['Recruiting'];
}

function renderPostCard(post) {
  const cat = getCategoryColor(post.category);
  return `
    <a href="/blog/${post.slug}.html" class="blog-card">
      <div class="blog-card-top">
        <span class="blog-card-cat" style="background:${cat.bg};color:${cat.color};">${post.category}</span>
        <span class="blog-card-lang">${post.langLabel}</span>
      </div>
      <div class="blog-card-title">${post.title}</div>
      <div class="blog-card-desc">${post.description}</div>
      <div class="blog-card-meta">
        <span>📅 ${post.dateLabel}</span>
        <span>⏱ ${post.readTime} min read</span>
      </div>
    </a>
  `;
}

function renderRelatedPosts(currentSlug) {
  const related = getRelatedPosts(currentSlug, 3);
  if (!related.length) return '';
  return `
    <section class="related-section">
      <div class="related-label">Related articles</div>
      <div class="related-grid">
        ${related.map(p => renderPostCard(p)).join('')}
      </div>
    </section>
  `;
}

function renderPrevNext(currentSlug) {
  const { prev, next } = getPrevNext(currentSlug);
  if (!prev && !next) return '';
  return `
    <nav class="post-nav" aria-label="Article navigation">
      <div class="post-nav-inner">
        ${prev ? `<a href="/blog/${prev.slug}.html" class="post-nav-btn post-nav-prev">
          <span class="post-nav-dir">← Previous</span>
          <span class="post-nav-title">${prev.title}</span>
        </a>` : '<div></div>'}
        ${next ? `<a href="/blog/${next.slug}.html" class="post-nav-btn post-nav-next">
          <span class="post-nav-dir">Next →</span>
          <span class="post-nav-title">${next.title}</span>
        </a>` : '<div></div>'}
      </div>
    </nav>
  `;
}
