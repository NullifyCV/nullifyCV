/* Keeps site navigation available when the desktop header collapses on mobile. */
(function () {
  'use strict';

  function initMobileNavigation() {
    var header = document.querySelector('.top-bar');
    var desktopNav = header && header.querySelector('.top-nav');
    if (!header || !desktopNav || header.querySelector('.mobile-menu-toggle')) return;

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-menu-toggle';
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'mobile-menu-panel');
    toggle.innerHTML = '<span class="mobile-menu-icon" aria-hidden="true">☰</span><span>Menu</span>';

    var panel = document.createElement('div');
    panel.id = 'mobile-menu-panel';
    panel.className = 'mobile-menu-panel';
    panel.hidden = true;

    var mobileNav = desktopNav.cloneNode(true);
    mobileNav.className = 'mobile-menu-links';
    mobileNav.setAttribute('aria-label', 'Mobile navigation');
    panel.appendChild(mobileNav);
    header.appendChild(toggle);
    header.appendChild(panel);

    function closeMenu() {
      panel.hidden = true;
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation menu');
      toggle.querySelector('.mobile-menu-icon').textContent = '☰';
    }

    function openMenu() {
      panel.hidden = false;
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close navigation menu');
      toggle.querySelector('.mobile-menu-icon').textContent = '×';
    }

    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      if (panel.hidden) openMenu(); else closeMenu();
    });

    mobileNav.addEventListener('click', closeMenu);
    document.addEventListener('click', function (event) {
      if (!header.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });
    window.matchMedia('(min-width: 721px)').addEventListener('change', function (event) {
      if (event.matches) closeMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNavigation, { once: true });
  } else {
    initMobileNavigation();
  }
})();
