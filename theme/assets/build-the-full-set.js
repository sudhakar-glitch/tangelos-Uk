/**
 * Build The Full Set — bundle block behaviour
 * Place in /assets/build-the-full-set.js
 *
 * - Toggles items on/off (checkmark <-> plus) — whole tile is the tap target
 * - Optionally adds/removes them from the real Shopify cart
 * - Recalculates the progress bar, top badge and sub total from the
 *   tiles actually rendered on the page (not from Liquid block.blocks,
 *   which a parent theme block can't reliably read at render time)
 * - Dispatches a `bundle:updated` CustomEvent other scripts can listen for
 */
(function () {
  'use strict';

  function formatMoney(cents, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'GBP',
        currencyDisplay: 'narrowSymbol',
      }).format((cents || 0) / 100);
    } catch (e) {
      return '£' + ((cents || 0) / 100).toFixed(2);
    }
  }

  function initBundle(root) {
    var items = Array.prototype.slice.call(root.querySelectorAll('[data-bfs-item]'));
    if (!items.length) return;

    var currency = root.dataset.currency || 'GBP';
    var autoAdd = root.dataset.autoAdd === 'true';
    var showBadge = root.dataset.showBadge === 'true';
    var showProgress = root.dataset.showProgress === 'true';
    var nextTierTemplate = root.dataset.nextTierTemplate || 'Add {count} more & save {percent}%';
    var allAddedLabel = root.dataset.allAddedLabel || "You're saving the max!";

    // Total possible % is the sum of every rendered tile's tier percent,
    // computed here (not in Liquid) since that's the only reliable source.
    var totalPercent = items.reduce(function (sum, item) {
      return sum + (parseInt(item.dataset.tierPercent, 10) || 0);
    }, 0);

    var badgeEl = root.querySelector('[data-bfs-total-badge]');
    var progressWrap = root.querySelector('[data-bfs-progress-wrap]');
    var achievedEl = root.querySelector('[data-bfs-achieved-percent]');
    var nextTierEl = root.querySelector('[data-bfs-next-tier]');
    var trackEl = root.querySelector('[data-bfs-progress-track]');
    var pillEl = root.querySelector('[data-bfs-progress-pill]');
    var ticksEl = root.querySelector('[data-bfs-progress-ticks]');
    var originalEl = root.querySelector('[data-bfs-original]');
    var finalEl = root.querySelector('[data-bfs-final]');
    var savedBadgeEl = root.querySelector('[data-bfs-saved-badge]');

    // Build one track segment + one tick label per item, sized proportionally
    // to that item's share of the total % — so each product's own stretch of
    // the bar lights up (and its "Saved X%" label appears) only once it's
    // actually selected.
    if (trackEl) {
      trackEl.innerHTML = '';
      items.forEach(function (item, index) {
        var tier = parseInt(item.dataset.tierPercent, 10) || 0;
        var basis = totalPercent > 0 ? (tier / totalPercent) * 100 : 0;
        var segment = document.createElement('div');
        segment.className = 'build-full-set__segment' + (index % 2 === 1 ? ' is-alt' : '');
        segment.style.flexBasis = basis + '%';
        segment.dataset.forItem = item.dataset.itemId;
        trackEl.appendChild(segment);
      });
    }
    if (ticksEl) {
      ticksEl.innerHTML = '';
      items.forEach(function (item) {
        var tier = parseInt(item.dataset.tierPercent, 10) || 0;
        var basis = totalPercent > 0 ? (tier / totalPercent) * 100 : 0;
        var tick = document.createElement('span');
        tick.className = 'build-full-set__tick';
        tick.style.flexBasis = basis + '%';
        tick.dataset.forItem = item.dataset.itemId;
        ticksEl.appendChild(tick);
      });
    }

    if (badgeEl) {
      if (showBadge && totalPercent > 0) {
        var customLabel = badgeEl.dataset.customLabel;
        badgeEl.textContent = customLabel ? customLabel : 'Save ' + totalPercent + '%';
        badgeEl.hidden = false;
      } else {
        badgeEl.hidden = true;
      }
    }

    if (progressWrap) {
      progressWrap.hidden = !(showProgress && totalPercent > 0);
    }

    function isSelected(item) {
      return item.dataset.selected === 'true';
    }

    function setSelected(item, selected) {
      item.dataset.selected = selected ? 'true' : 'false';
      item.classList.toggle('is-selected', selected);
      var toggle = item.querySelector('[data-bfs-toggle]');
      if (toggle) toggle.setAttribute('aria-pressed', selected ? 'true' : 'false');

      var inCart = item.querySelector('[data-bfs-status-in-cart]');
      var off = item.querySelector('[data-bfs-status-off]');
      if (inCart) inCart.hidden = !selected;
      if (off) off.hidden = selected;
    }

    function recalculate() {
      var achievedPercent = 0;
      var originalCents = 0;
      var selectedCount = 0;

      items.forEach(function (item) {
        var selected = isSelected(item);
        var itemId = item.dataset.itemId;
        var tier = parseInt(item.dataset.tierPercent, 10) || 0;

        var segment = trackEl && trackEl.querySelector('[data-for-item="' + itemId + '"]');
        if (segment) segment.classList.toggle('is-filled', selected);

        var tick = ticksEl && ticksEl.querySelector('[data-for-item="' + itemId + '"]');
        if (tick) tick.textContent = selected ? 'Saved ' + tier + '%' : '';

        if (!selected) return;
        achievedPercent += tier;
        originalCents += parseInt(item.dataset.compareCents, 10) || parseInt(item.dataset.priceCents, 10) || 0;
        selectedCount++;
      });

      if (achievedPercent > totalPercent) achievedPercent = totalPercent;

      var finalCents = Math.round(originalCents * (1 - achievedPercent / 100));
      var remainingCount = items.filter(function (item) {
        return !isSelected(item);
      }).length;

      if (achievedEl) achievedEl.textContent = achievedPercent;
      if (pillEl) {
        if (achievedPercent > 0) {
          var pillLeft = totalPercent > 0 ? (achievedPercent / totalPercent) * 100 : 0;
          pillEl.style.left = pillLeft + '%';
          pillEl.textContent = achievedPercent + '%';
          pillEl.hidden = false;
        } else {
          pillEl.hidden = true;
        }
      }
      if (nextTierEl) {
        if (remainingCount > 0) {
          nextTierEl.textContent = nextTierTemplate
            .replace('{count}', remainingCount)
            .replace('{percent}', totalPercent);
        } else {
          nextTierEl.textContent = allAddedLabel;
        }
      }
      if (originalEl) originalEl.textContent = formatMoney(originalCents, currency);
      if (finalEl) finalEl.textContent = formatMoney(finalCents, currency);
      if (savedBadgeEl) savedBadgeEl.textContent = 'Saved ' + achievedPercent + '%';

      root.dispatchEvent(
        new CustomEvent('bundle:updated', {
          bubbles: true,
          detail: {
            achievedPercent: achievedPercent,
            totalPercent: totalPercent,
            originalCents: originalCents,
            finalCents: finalCents,
            selectedCount: selectedCount,
          },
        })
      );
    }

    function addToCart(variantId) {
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
      }).then(function (res) {
        if (!res.ok) throw new Error('Add to cart failed');
        return res.json();
      });
    }

    function removeFromCart(variantId) {
      return fetch('/cart.js')
        .then(function (res) { return res.json(); })
        .then(function (cart) {
          var line = cart.items.find(function (li) {
            return String(li.variant_id) === String(variantId);
          });
          if (!line) return null;
          return fetch('/cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ id: line.key, quantity: 0 }),
          }).then(function (res) {
            if (!res.ok) throw new Error('Remove from cart failed');
            return res.json();
          });
        });
    }

    function refreshCartUI() {
      // Best-effort hook for the rest of the theme (cart drawer / count bubble).
      document.dispatchEvent(new CustomEvent('cart:refresh'));
      fetch('/cart.js')
        .then(function (res) { return res.json(); })
        .then(function (cart) {
          document.querySelectorAll('[data-cart-count]').forEach(function (el) {
            el.textContent = cart.item_count;
          });
        })
        .catch(function () {});
    }

    items.forEach(function (item) {
      var toggle = item.querySelector('[data-bfs-toggle]');
      if (!toggle) return;

      toggle.addEventListener('click', function () {
        if (item.dataset.required === 'true') return; // e.g. the product already being viewed

        var nextSelected = !isSelected(item);
        var variantId = item.dataset.variantId;

        if (!autoAdd || !variantId) {
          setSelected(item, nextSelected);
          recalculate();
          return;
        }

        toggle.disabled = true;
        var request = nextSelected ? addToCart(variantId) : removeFromCart(variantId);

        request
          .then(function () {
            setSelected(item, nextSelected);
            recalculate();
            refreshCartUI();
          })
          .catch(function (err) {
            console.error('[build-the-full-set]', err);
          })
          .finally(function () {
            toggle.disabled = false;
          });
      });
    });

    recalculate();
  }

  function init() {
    document.querySelectorAll('[data-build-full-set]').forEach(initBundle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init inside the theme editor when this block is added/reordered.
  document.addEventListener('shopify:block:select', function (event) {
    var root = event.target.closest('[data-build-full-set]');
    if (root) initBundle(root);
  });
})();
