/* ==========================================================================
   Tangelos swatches

   Handles size selection on the product page and colour preview on collection
   cards. Colour switching itself is a plain link - each colour is a separate
   product with its own URL, which keeps it crawlable and shareable.

   No dependencies. Safe to load with defer.

   ---------------------------------------------------------------------------
   Persistence note (the "King resets to Single on reload" fix)

   Three separate things had to line up for a refresh to keep the chosen size,
   and any one of them failing produced the same visible symptom:

     1. Clicking a size must write ?variant=ID into the URL.
     2. On load, the snippet must render that variant as selected server-side.
     3. Nothing must overwrite the selection afterwards.

   Step 3 is the one that bites on Horizon-family themes, which re-render the
   product section after our script has already run and reset the buttons to
   the theme's own default. So this file no longer trusts a single pass: it
   re-asserts the URL variant on a few frames after load, on bfcache restore,
   and whenever something wipes the selection out from under us. The reassert
   stops the moment the shopper clicks a size themselves - their choice always
   outranks the URL.
   ========================================================================== */

(function () {
  'use strict';

  var LOW_STOCK_AT = 5;

  /* ------------------------------------------------------ product page -- */

  function initSizeSelector(root) {
    if (root.dataset.tngBound === 'true') return; // never double-bind
    root.dataset.tngBound = 'true';

    var buttons = root.querySelectorAll('[data-tng-size]');
    if (!buttons.length) return;

    var requireSize = root.dataset.requireSize === 'true';
    var label = root.querySelector('[data-tng-size-label]');
    var stock = root.querySelector('[data-tng-stock]');
    var prompt = root.querySelector('[data-tng-size-prompt]');

    var form = root.closest('form[action*="/cart/add"]') ||
               document.querySelector('form[action*="/cart/add"]');
    var idInput = form ? form.querySelector('input[name="id"], select[name="id"]') : null;
    var addButton = form ? form.querySelector('[type="submit"], [name="add"]') : null;

    var variants = [];
    var json = document.querySelector('[data-tng-variants]');
    if (json) {
      try { variants = JSON.parse(json.textContent); } catch (e) { variants = []; }
    }

    // Set once the shopper clicks. From then on we stop re-asserting the URL,
    // so we can never fight a live choice.
    var userTouched = false;

    // Guards the MutationObserver against reacting to our own class changes.
    var applying = false;

    function findVariant(id) {
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === String(id)) return variants[i];
      }
      return null;
    }

    function findButton(variantId) {
      if (!variantId) return null;
      for (var i = 0; i < buttons.length; i++) {
        if (String(buttons[i].dataset.variantId) === String(variantId)) return buttons[i];
      }
      return null;
    }

    function selectedButton() {
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].classList.contains('is-selected')) return buttons[i];
      }
      return null;
    }

    // The variant the page is *supposed* to be showing. The URL is the source
    // of truth; the snippet's data-url-variant is a server-rendered backup for
    // the case where a theme script has already stripped the query string.
    function desiredVariantId() {
      var fromUrl = new URLSearchParams(window.location.search).get('variant');
      return fromUrl || root.dataset.urlVariant || null;
    }

    function setAddButton(enabled, text) {
      if (!addButton) return;
      addButton.disabled = !enabled;
      addButton.setAttribute('aria-disabled', String(!enabled));
      if (text) {
        if (!addButton.dataset.tngOriginal) {
          addButton.dataset.tngOriginal = addButton.textContent.trim();
        }
        addButton.textContent = text;
      } else if (addButton.dataset.tngOriginal) {
        addButton.textContent = addButton.dataset.tngOriginal;
      }
    }

    function updatePrice(variant) {
      // Works with Dawn-family markup; adjust the selector for other themes.
      var target = document.querySelector('[data-tng-price], .price__regular .price-item--regular');
      if (target && variant && variant.price) target.textContent = variant.price;
    }

    function updateImage(variant) {
      if (!variant || !variant.image) return;
      var img = document.querySelector('[data-tng-main-image]');
      if (img) {
        img.src = variant.image;
        img.srcset = '';
      }
    }

    function select(button, pushState) {
      if (!button) return;
      if (button.classList.contains('is-unavailable')) return;

      applying = true;

      Array.prototype.forEach.call(buttons, function (b) {
        b.classList.toggle('is-selected', b === button);
      });

      var variant = findVariant(button.dataset.variantId);
      if (label) label.textContent = button.dataset.size;
      if (idInput) idInput.value = button.dataset.variantId;

      updatePrice(variant);
      updateImage(variant);
      setAddButton(true, null);
      if (prompt) prompt.hidden = true;

      // Low-stock nudge, only when it is genuinely low.
      if (stock) {
        var qty = variant ? variant.inventory : 0;
        if (qty > 0 && qty <= LOW_STOCK_AT) {
          stock.textContent = 'Only ' + qty + ' left in ' + button.dataset.size + '.';
          stock.hidden = false;
        } else {
          stock.hidden = true;
        }
      }

      // Keep the URL honest so refresh and share both land on this variant.
      if (pushState && window.history && history.replaceState) {
        var url = new URL(window.location.href);
        url.searchParams.set('variant', button.dataset.variantId);
        url.searchParams.delete('size');
        history.replaceState({}, '', url.toString());
        // Mirror it onto the fieldset so a later theme re-render still has it
        // even if something clears the query string.
        root.dataset.urlVariant = button.dataset.variantId;
      }

      // Let the theme react (sticky bars, cart drawers, and so on).
      root.dispatchEvent(new CustomEvent('tng:variant:change', {
        bubbles: true,
        detail: { variant: variant }
      }));

      // Release the observer guard after the browser has painted, so our own
      // class changes are never mistaken for the theme resetting us.
      window.requestAnimationFrame(function () { applying = false; });
    }

    function clearSelection() {
      applying = true;
      Array.prototype.forEach.call(buttons, function (b) {
        b.classList.remove('is-selected');
      });
      if (label) label.textContent = 'Select a size';
      if (idInput) idInput.value = '';
      setAddButton(false, 'Select a size');
      window.requestAnimationFrame(function () { applying = false; });
    }

    /* Re-apply the URL variant if the page has drifted away from it. Cheap,
       idempotent, and a no-op once the shopper has clicked anything. */
    function reassert() {
      if (userTouched) return;

      var wantId = desiredVariantId();
      if (!wantId) return;

      var wantButton = findButton(wantId);
      if (!wantButton) return;

      var current = selectedButton();
      if (current === wantButton) return; // already correct, nothing to do

      select(wantButton, false);
    }

    /* ---- bind clicks ---- */

    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        userTouched = true;
        select(button, true);
      });
    });

    /* ---- first pass: ?variant= wins, then ?size= from a colour switch ---- */

    var params = new URLSearchParams(window.location.search);
    var wanted = params.get('variant') || root.dataset.urlVariant || null;
    var wantedSize = params.get('size');
    var matched = null;

    Array.prototype.forEach.call(buttons, function (button) {
      if (matched) return;
      if (wanted && String(button.dataset.variantId) === String(wanted)) matched = button;
      else if (!wanted && wantedSize && button.dataset.size === wantedSize) matched = button;
    });

    if (matched) {
      select(matched, false);
      // A colour switch arrives as ?size=King with no variant id. Upgrade the
      // URL to the real variant so the next reload is exact, not name-matched.
      if (!params.get('variant') && window.history && history.replaceState) {
        var u = new URL(window.location.href);
        u.searchParams.set('variant', matched.dataset.variantId);
        u.searchParams.delete('size');
        history.replaceState({}, '', u.toString());
        root.dataset.urlVariant = matched.dataset.variantId;
      }
    } else if (requireSize) {
      // No default size. This is the whole point: it stops wrong-size orders.
      clearSelection();

      if (form) {
        form.addEventListener('submit', function (e) {
          if (!idInput || !idInput.value) {
            e.preventDefault();
            if (prompt) prompt.hidden = false;
            root.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      }
    }

    /* ---- later passes: survive theme re-renders ----

       Horizon and other section-rendering themes repaint the product block
       after DOMContentLoaded. One pass is not enough, so check again on the
       next frame and twice more shortly after. These are no-ops when nothing
       has moved. */

    if (desiredVariantId()) {
      window.requestAnimationFrame(reassert);
      window.setTimeout(reassert, 200);
      window.setTimeout(reassert, 800);

      // Watch the button row. If something strips is-selected, put it back.
      if (window.MutationObserver) {
        var row = buttons[0].parentNode;
        var observer = new MutationObserver(function () {
          if (applying || userTouched) return;
          reassert();
        });
        observer.observe(row, {
          subtree: true,
          attributes: true,
          attributeFilter: ['class']
        });
        // Stop watching once the page has settled. Leaving an observer running
        // for the whole session is wasted work and can fight late scripts.
        window.setTimeout(function () { observer.disconnect(); }, 5000);
      }
    }

    // Back/forward cache restore hands back a page that never re-runs init.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) reassert();
    });

    // Browser back/forward between variants.
    window.addEventListener('popstate', function () {
      userTouched = false;
      reassert();
    });
  }

  /* --------------------------------------------------- collection cards -- */

  function initCardSwatches(group) {
    var card = group.closest('[data-tng-card]');
    if (!card) return;
    var image = card.querySelector('[data-tng-card-image]');
    if (!image) return;

    var original = image.currentSrc || image.src;
    var originalSrcset = image.srcset || '';

    group.querySelectorAll('[data-tng-card-swatch]').forEach(function (swatch) {
      function preview() {
        if (!swatch.dataset.image) return;
        image.srcset = '';
        image.src = swatch.dataset.image;
      }
      function restore() {
        image.src = original;
        image.srcset = originalSrcset;
      }
      swatch.addEventListener('mouseenter', preview);
      swatch.addEventListener('focus', preview);
      swatch.addEventListener('mouseleave', restore);
      swatch.addEventListener('blur', restore);
    });
  }

  /* ---------------------------------------------------------- bootstrap -- */

  function init(scope) {
    (scope || document).querySelectorAll('[data-tng-size-selector]').forEach(initSizeSelector);
    (scope || document).querySelectorAll('[data-tng-card-swatches]').forEach(initCardSwatches);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }

  // Re-run after theme editor edits and after any AJAX collection paging.
  // data-tng-bound stops these from double-binding an already-live selector.
  document.addEventListener('shopify:section:load', function (e) { init(e.target); });
  document.addEventListener('tng:refresh', function (e) { init(e.target); });
})();