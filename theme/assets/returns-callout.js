document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.returns-callout').forEach(function (root) {
    var trigger = root.querySelector('.returns-callout__trigger');
    var drawer = root.querySelector('.returns-callout__drawer');
    var closeBtn = root.querySelector('.returns-callout__close');
    var ctaBtn = root.querySelector('.returns-callout__cta');
    var backdrop = root.querySelector('.returns-callout__backdrop');

    var MARGIN = 16; // gap to leave from the viewport edge
    var GAP = 8; // gap between trigger and drawer

    function positionDrawer() {
      var triggerRect = trigger.getBoundingClientRect();
      var viewportHeight = window.innerHeight;
      var spaceBelow = viewportHeight - triggerRect.bottom - GAP - MARGIN;
      var spaceAbove = triggerRect.top - GAP - MARGIN;

      // match the drawer's width/left to the trigger card
      drawer.style.left = triggerRect.left + 'px';
      drawer.style.width = triggerRect.width + 'px';

      // measure natural content height with no cap
      drawer.style.maxHeight = 'none';
      drawer.style.top = '';
      drawer.style.bottom = '';
      drawer.style.transform = '';
      var naturalHeight = drawer.scrollHeight;

      if (naturalHeight <= spaceBelow) {
        // fits below the trigger (trigger near top of viewport)
        drawer.style.top = (triggerRect.bottom + GAP) + 'px';
        drawer.style.bottom = 'auto';
        drawer.style.transform = 'none';
        drawer.style.maxHeight = spaceBelow + 'px';
      } else if (naturalHeight <= spaceAbove) {
        // fits above the trigger (trigger near bottom of viewport)
        drawer.style.top = 'auto';
        drawer.style.bottom = (viewportHeight - triggerRect.top + GAP) + 'px';
        drawer.style.transform = 'none';
        drawer.style.maxHeight = spaceAbove + 'px';
      } else {
        // doesn't fully fit either way (trigger around the middle) — center in viewport
        drawer.style.top = '50%';
        drawer.style.bottom = 'auto';
        drawer.style.transform = 'translateY(-50%)';
        drawer.style.maxHeight = (viewportHeight - MARGIN * 2) + 'px';
      }
    }

    function openDrawer() {
      root.classList.add('is-open');
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      trigger.setAttribute('aria-expanded', 'true');
      positionDrawer();
    }

    function closeDrawer() {
      root.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
      // wait for the closing transition before hiding from a11y tree
      window.setTimeout(function () {
        if (!root.classList.contains('is-open')) {
          drawer.hidden = true;
        }
      }, 200);
    }

    window.addEventListener('resize', function () {
      if (root.classList.contains('is-open')) {
        positionDrawer();
      }
    });

    window.addEventListener('scroll', function () {
      if (root.classList.contains('is-open')) {
        positionDrawer();
      }
    }, { passive: true });

    trigger.addEventListener('click', function () {
      var isOpen = root.classList.contains('is-open');
      if (isOpen) {
        closeDrawer();
      } else {
        // openDrawer();
      }
    });

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (ctaBtn) ctaBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('is-open')) {
        closeDrawer();
      }
    });
  });
});
