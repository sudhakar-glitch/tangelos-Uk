import { DialogComponent, DialogOpenEvent, DialogCloseEvent } from '@theme/dialog';
import { CartAddEvent, CartUpdateEvent } from '@theme/events';
import { isMobileBreakpoint } from '@theme/utilities';

/**
 * A custom element that manages a cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement} [liveRegion] - The live region for cart announcements when dialog is open.
 *
 * @extends {DialogComponent}
 */
class CartDrawerComponent extends DialogComponent {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {AbortController | null} */
  #historyAbortController = null;

  /** @type {AbortController | null} */
  #installmentsAbortController = null;

  /**
   * True while a history.back() we triggered has not fired its popstate yet.
   * Prevents the "reopen then instantly close" race on mobile.
   * @type {boolean}
   */
  #backPending = false;

  /** True when the drawer had items at the moment it opened. */
  #hadItemsOnOpen = false;

  /** True when any cart change happened while the drawer was open. */
  #cartChangedWhileOpen = false;

  /** Stops a double reload. */
  #reloading = false;

  /** Stops a double close while the drawer is being shut for an empty cart. */
  #closingEmpty = false;

  /** Debounce timer for the empty-cart check. */
  #emptyTimer = 0;

  /**
   * True once this page has seen a cart with items (or any cart change).
   * Without it, a page that simply loads with an empty cart could reload itself.
   */
  #sawItems = false;

  /** Debounce timer and lock for the upsell cleanup. */
  #orphanTimer = 0;
  #orphanRunning = false;
  #orphanAgain = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    // Horizon fires 'cart:update' for adds AND for removes inside the drawer.
    // (If CartAddEvent.eventName is also 'cart:update', the browser ignores the duplicate.)
    document.addEventListener(CartAddEvent.eventName, this.#handleCartChange);
    document.addEventListener('cart:update', this.#handleCartChange);
    this.addEventListener(DialogOpenEvent.eventName, this.#handleOpen);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleClose);

    // The native <dialog> 'close' event does not bubble, so listen in the capture phase.
    // This catches closes that skip closeDialog() (e.g. the Escape key).
    this.addEventListener('close', this.#handleNativeClose, true);

    if (history.state?.cartDrawerOpen) {
      history.replaceState(null, '');
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.#orphanTimer);
    clearTimeout(this.#emptyTimer);
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartChange);
    document.removeEventListener('cart:update', this.#handleCartChange);
    this.removeEventListener(DialogOpenEvent.eventName, this.#handleOpen);
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleClose);
    this.removeEventListener('close', this.#handleNativeClose, true);
    this.#historyAbortController?.abort();
    this.#installmentsAbortController?.abort();
  }

  get #root() {
    return window.Shopify?.routes?.root || '/';
  }

  /**
   * Item count carried by a theme cart event, or null when the event has none.
   * Horizon's line-item removal sends the new total in data.itemCount
   * (resource is an empty object there), so data is checked first.
   * @param {CustomEvent<{ resource?: { item_count?: number }, data?: { itemCount?: number } }>} event
   * @returns {number | null}
   */
  #countFromEvent(event) {
    const detail = event?.detail || {};
    const count = detail.data?.itemCount ?? detail.resource?.item_count;
    return typeof count === 'number' ? count : null;
  }

  #handleOpen = () => {
    this.#cartChangedWhileOpen = false;
    this.#hadItemsOnOpen = this.#drawerHasItems();
    if (this.#hadItemsOnOpen) this.#sawItems = true;
    this.#updateStickyState();
    this.#handleHistoryOpen();
    // Catch upsells left behind on pages where the cleanup couldn't run.
    this.#queueOrphanCheck();
  };

  /**
   * Runs on every theme cart event (add, remove, quantity change, our cleanup).
   * @param {CustomEvent<{ resource?: { item_count?: number }, data?: { source?: string, itemCount?: number } }>} event
   */
  #handleCartChange = (event) => {
    // A cart event means the cart changed on this page, so an empty cart
    // after it is a real "emptied" state worth reloading for.
    this.#sawItems = true;
    if (this.refs.dialog?.open) this.#cartChangedWhileOpen = true;

    // The cart is empty right now: close at once so the shopper never sees
    // the blank drawer (header + close button over an empty body).
    if (this.#countFromEvent(event) === 0) {
      this.#closeEmptyDrawer();
      return;
    }

    // Make sure no upsell is left in the cart without its main product.
    if (event.detail?.data?.source !== 'upsell-cleanup') this.#queueOrphanCheck();

    // Backup for events that carry no count.
    this.#queueEmptyCheck();
  };

  /**
   * Closes the drawer immediately (no closing animation) and reloads the page
   * once Shopify confirms the cart is empty.
   */
  async #closeEmptyDrawer() {
    if (this.#closingEmpty || this.#reloading) return;
    this.#closingEmpty = true;
    clearTimeout(this.#emptyTimer);
    clearTimeout(this.#orphanTimer);

    const dialog = this.refs.dialog;
    try {
      if (dialog?.open) {
        this.#cartChangedWhileOpen = true;
        dialog.style.setProperty('--dialog-drawer-closing-animation', 'none');
        try {
          await this.closeDialog(); // #handleClose runs from here and starts the reload check
        } finally {
          dialog.style.removeProperty('--dialog-drawer-closing-animation');
        }
      }
      // Covers the case where the dialog was already closed, or the close
      // event did not fire. #reloadIfCartEmpty guards against double reloads.
      await this.#reloadIfCartEmpty();
    } finally {
      this.#closingEmpty = false;
    }
  }

  /**
   * Waits for any in-flight cart work (theme removal animation, upsell
   * cleanup) to settle, then reloads once if the cart is empty.
   */
  #queueEmptyCheck() {
    clearTimeout(this.#emptyTimer);
    this.#emptyTimer = window.setTimeout(() => this.#reloadIfCartEmpty(), 600);
  }

  /** The summary block (subtotal + checkout) only exists when the cart has items. */
  #drawerHasItems() {
    return !!this.refs.dialog?.querySelector('.cart-drawer__summary');
  }

  /* ---------------- empty cart -> reload on close ---------------- */

  #handleClose = () => {
    // Backup for anything that emptied the cart without firing a cart event.
    const shouldCheck = this.#hadItemsOnOpen || this.#cartChangedWhileOpen;
    this.#hadItemsOnOpen = false;
    this.#cartChangedWhileOpen = false;

    this.#handleHistoryClose();

    if (shouldCheck) this.#reloadIfCartEmpty();
  };

  /**
   * @param {Event} event
   */
  #handleNativeClose = (event) => {
    // Ignore 'close' events from other dialogs nested inside the drawer.
    if (event.target !== this.refs.dialog) return;
    this.#handleClose();
  };

  // Asks Shopify for the real cart instead of trusting the drawer markup or
  // event data, so it works however the cart was emptied.
  async #reloadIfCartEmpty() {
    if (this.#reloading) return;

    let itemCount = null;
    try {
      const response = await fetch(`${this.#root}cart.js`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      itemCount = (await response.json()).item_count;
    } catch (error) {
      console.warn('[cart-drawer] Could not read cart:', error);
      return;
    }

    // Only reload when a cart that HAD items became empty. Reloading a cart
    // that was already empty would fight with whatever the shopper is doing.
    if (itemCount > 0) this.#sawItems = true;
    if (itemCount !== 0 || !this.#sawItems || this.#reloading) return;
    this.#reloading = true;
    clearTimeout(this.#emptyTimer);
    clearTimeout(this.#orphanTimer);

    // Never reload with the drawer still on screen.
    if (this.refs.dialog?.open) {
      this.refs.dialog.style.setProperty('--dialog-drawer-closing-animation', 'none');
      try {
        await this.closeDialog();
      } catch (e) {
        this.refs.dialog.close?.();
      }
    }

    if (this.#backPending) {
      // On mobile, wait for our history.back() to finish so the reload
      // happens on the real page entry, not the drawer's history entry.
      window.addEventListener('popstate', () => window.location.reload(), { once: true });
      setTimeout(() => window.location.reload(), 600); // safety net
    } else {
      // Drop the drawer's history entry so the reloaded page doesn't
      // reopen it or leave the back button pointing at it.
      if (history.state?.cartDrawerOpen) history.replaceState(null, '');
      window.location.reload();
    }
  }

  /* ---------------- remove upsells when main product is removed ---------------- */

  // Upsells added together with a main product carry a hidden line property
  // `_parent_variant` (the main product's variant id). If no cart line with that
  // variant id is left, the upsell lines are removed too.

  #queueOrphanCheck() {
    clearTimeout(this.#orphanTimer);
    this.#orphanTimer = window.setTimeout(() => this.#removeOrphanUpsells(), 250);
  }

  /**
   * Section ids of every cart-items-component on the page (drawer and cart
   * page). This is the same list the theme itself asks for when it changes a
   * line, so the HTML that comes back is the HTML the theme knows how to morph.
   */
  #cartSectionIds() {
    return [
      ...new Set(
        [...document.querySelectorAll('cart-items-component[data-section-id]')].map(
          (el) => /** @type {HTMLElement} */ (el).dataset.sectionId
        )
      ),
    ].filter(Boolean);
  }

  async #removeOrphanUpsells() {
    if (this.#reloading) return;
    if (this.#orphanRunning) {
      this.#orphanAgain = true;
      return;
    }
    this.#orphanRunning = true;

    try {
      const cartResponse = await fetch(`${this.#root}cart.js`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const cart = await cartResponse.json();

      const variantsInCart = new Set(cart.items.map((item) => String(item.variant_id)));
      /** @type {Record<string, number>} */
      const updates = {};
      let orphanCount = 0;

      for (const item of cart.items) {
        const parent = item.properties?._parent_variant;
        if (parent && !variantsInCart.has(String(parent))) {
          updates[item.key] = 0;
          orphanCount++;
        }
      }

      if (!orphanCount) return;

      const sectionIds = this.#cartSectionIds();
      /** @type {{ updates: Record<string, number>, sections?: string, sections_url?: string }} */
      const body = { updates };
      if (sectionIds.length) {
        body.sections = sectionIds.join(',');
        body.sections_url = window.location.pathname;
      }

      const updateResponse = await fetch(`${this.#root}cart/update.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!updateResponse.ok) throw new Error(`cart/update.js returned ${updateResponse.status}`);
      const updatedCart = await updateResponse.json();

      // Hand the freshly rendered section HTML to the theme. cart-items-component
      // morphs itself from data.sections. If this emptied the cart, the event's
      // itemCount of 0 makes #handleCartChange close the drawer straight away.
      document.dispatchEvent(
        new CartUpdateEvent(updatedCart, 'upsell-cleanup', {
          source: 'upsell-cleanup',
          itemCount: updatedCart.item_count,
          sections: updatedCart.sections,
        })
      );
    } catch (error) {
      console.warn('[cart-drawer] Could not remove upsells without their main product:', error);
    } finally {
      this.#orphanRunning = false;
      if (this.#orphanAgain) {
        this.#orphanAgain = false;
        this.#queueOrphanCheck();
      }
    }
  }

  /* ---------------- mobile back button ---------------- */

  #handleHistoryOpen() {
    // Always clean up the previous listener first, so repeated opens
    // (e.g. several add-to-carts) never leave orphaned popstate listeners.
    this.#historyAbortController?.abort();
    this.#historyAbortController = null;

    if (!isMobileBreakpoint()) return;

    const controller = new AbortController();
    this.#historyAbortController = controller;
    const { signal } = controller;

    const attach = () => {
      if (signal.aborted || !this.refs.dialog?.open) return;

      if (!history.state?.cartDrawerOpen) {
        history.pushState({ cartDrawerOpen: true }, '');
      }

      window.addEventListener('popstate', this.#handlePopState, { signal });
    };

    if (this.#backPending) {
      // The previous close's history.back() hasn't landed yet.
      // Wait for it, otherwise its popstate would close the drawer we just opened.
      window.addEventListener('popstate', attach, { once: true, signal });
    } else {
      attach();
    }
  }

  #handleHistoryClose() {
    this.#historyAbortController?.abort();
    this.#historyAbortController = null;

    // Guard against calling back() twice (DialogCloseEvent + native close both fire).
    if (history.state?.cartDrawerOpen && !this.#backPending) {
      this.#backPending = true;
      window.addEventListener(
        'popstate',
        () => {
          this.#backPending = false;
        },
        { once: true }
      );
      history.back();
    }
  }

  #handlePopState = async () => {
    const dialog = this.refs.dialog;
    if (!dialog?.open) return;

    dialog.style.setProperty('--dialog-drawer-closing-animation', 'none');
    try {
      await this.closeDialog();
    } finally {
      dialog.style.removeProperty('--dialog-drawer-closing-animation');
    }
  };

  /* ---------------- cart add ---------------- */

  /**
   * Handles cart add events - opens drawer if auto-open and announces count when open.
   * @param {CustomEvent<{ resource?: { item_count?: number }, data?: { source?: string, itemCount?: number } }>} event
   */
  #handleCartAdd = (event) => {
    // The upsell cleanup is a removal, not an add - never auto-open for it.
    if (event.detail?.data?.source === 'upsell-cleanup') return;

    const count = this.#countFromEvent(event);
    // An event reporting an empty cart is a removal - never auto-open for it.
    if (count === 0) return;
    if (typeof count === 'number' && count > 0) this.#sawItems = true;

    if (this.hasAttribute('auto-open') && !this.refs.dialog?.open && !this.#reloading) {
      this.showDialog();
    }

    this.#announceCartCount(event.detail?.resource?.item_count);
  };

  /**
   * Announces cart count to screen readers when dialog is open.
   * @param {number | undefined} cartCount
   */
  #announceCartCount(cartCount) {
    const liveRegion = /** @type {HTMLElement | undefined} */ (this.refs.liveRegion);
    if (!this.refs.dialog?.open || !liveRegion || cartCount === undefined) return;

    liveRegion.textContent = `${Theme.translations.cart_count}: ${cartCount}`;
  }

  open() {
    if (!this.refs.dialog?.open) {
      this.showDialog();
    }

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs.
     * The abort controller stops listeners from piling up on every open.
     */
    this.#installmentsAbortController?.abort();
    this.#installmentsAbortController = new AbortController();
    const { signal } = this.#installmentsAbortController;

    customElements.whenDefined('shopify-payment-terms').then(() => {
      if (signal.aborted) return;
      const installmentsContent = document.querySelector('shopify-payment-terms')?.shadowRoot;
      const cta = installmentsContent?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', () => this.closeDialog(), { once: true, signal });
    });
  }

  close() {
    this.closeDialog();
  }

  #updateStickyState() {
    const { dialog } = /** @type {Refs} */ (this.refs);
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}