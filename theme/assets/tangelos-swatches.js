// Swaps a product card's image when hovering a colour swatch.
// Only active on <tangelos-swatches data-swap-image="true">.
// Safe to load more than once - the guard below makes re-execution a no-op.
(function () {
  if (customElements.get('tangelos-swatches')) return;

  class TangelosSwatches extends HTMLElement {
    connectedCallback() {
      if (this.dataset.swapImage !== 'true') return;

      const card = this.closest('product-card') || this.closest('.product-card');
      this.image = card ? card.querySelector('img') : null;
      if (!this.image) return;

      this.handleOver = this.handleOver.bind(this);
      this.handleOut = this.handleOut.bind(this);

      this.addEventListener('pointerover', this.handleOver);
      this.addEventListener('pointerleave', this.handleOut);
      this.addEventListener('focusin', this.handleOver);
      this.addEventListener('focusout', this.handleOut);

      // Warm the cache on first approach so the swap doesn't flash white.
      this.addEventListener('pointerenter', () => this.preload(), { once: true });
    }

    disconnectedCallback() {
      this.removeEventListener('pointerover', this.handleOver);
      this.removeEventListener('pointerleave', this.handleOut);
      this.removeEventListener('focusin', this.handleOver);
      this.removeEventListener('focusout', this.handleOut);
    }

    preload() {
      this.querySelectorAll('[data-preview]').forEach((swatch) => {
        const img = new Image();
        img.src = swatch.dataset.preview;
      });
    }

    handleOver(event) {
      // Touch taps should just follow the link, not preview.
      if (event.pointerType === 'touch') return;

      const swatch = event.target.closest('[data-preview]');
      if (!swatch || !this.image) return;

      // Captured on entry rather than at connect time, so the theme's own
      // gallery behaviour can't leave us restoring a stale image later.
      if (this.restoreSrc === undefined) {
        this.restoreSrc = this.image.getAttribute('src');
        this.restoreSrcset = this.image.getAttribute('srcset');
      }

      // srcset wins over src, so it has to go for the swap to be visible.
      this.image.removeAttribute('srcset');
      this.image.setAttribute('src', swatch.dataset.preview);
    }

    handleOut() {
      if (!this.image || this.restoreSrc === undefined) return;

      if (this.restoreSrcset) {
        this.image.setAttribute('srcset', this.restoreSrcset);
      } else {
        this.image.removeAttribute('srcset');
      }
      if (this.restoreSrc) this.image.setAttribute('src', this.restoreSrc);

      this.restoreSrc = undefined;
      this.restoreSrcset = undefined;
    }
  }

  customElements.define('tangelos-swatches', TangelosSwatches);
})();
