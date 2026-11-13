'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(function (entry) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'icons' && entry.name !== 'api' && entry.name !== 'lib' && entry.name !== 'tests') return htmlFiles(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}

test('every page with the shared header loads the accessible mobile navigation', function () {
  const pages = htmlFiles(root).filter(function (file) {
    return fs.readFileSync(file, 'utf8').includes('<header class="top-bar"');
  });
  assert.ok(pages.length >= 20, 'expected the shared header across the public pages');
  for (const page of pages) {
    assert.match(fs.readFileSync(page, 'utf8'), /<script src="\/mobile-nav\.js" defer><\/script>/, page + ' does not load mobile navigation');
  }
});

test('mobile navigation has an accessible toggle and closes outside mobile widths', function () {
  const source = fs.readFileSync(path.join(root, 'mobile-nav.js'), 'utf8');
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-controls/);
  assert.match(source, /Escape/);
  assert.match(source, /min-width: 721px/);
});
