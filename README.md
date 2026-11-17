# Tangelos UK – Shopify store backup

Snapshot of **www.tangelos.co.uk** (Shopify, GBP) taken **17 Nov 2026** via the Shopify Admin GraphQL API.

| What | Where | Count |
|---|---|---|
| Live theme `tangelos-new-theme--UX/CRO-Audit-changes-PDP` (`OnlineStoreTheme/200740798624`) | `theme/` | 483 files |
| Products (incl. variants, options, SEO, metafields, image URLs) | `shopify/products.jsonl` | 291 products · 902 variants · 829 images |
| Collections (incl. SEO, image, metafields, condition sources, product handles) | `shopify/collections.jsonl` | 67 collections |
| Customers | **not in git** – see below | 2,066 |
| Orders | **not in git** – see below | 1,073 (#1001 – #2116) |

Product status breakdown: 219 active, 37 draft, 29 unlisted, 6 archived.

## Customers & orders

Customer and order exports contain personal data (names, emails, phones, addresses).
This repository is currently **public**, so they are deliberately excluded (`shopify/private/` is git-ignored).
Make the repo private before committing them.

## File formats

- `*.jsonl` – one JSON object per line, field names as in the Shopify Admin GraphQL API (2026-10).
- `collections.jsonl` → `productHandles` is the complete membership list (verified against `productsCount`).
  `sources` describes automated-collection conditions (titles/descriptions only; rebuild the rules in admin when restoring).
- Theme files were verified against Shopify's MD5 checksums. JSON templates/locales/`settings_data.json` are returned
  by Shopify pretty-printed with an auto-generated header comment, so their bytes differ from the stored (minified)
  version — the content is identical and they upload back unchanged.

## Restoring

- **Theme:** zip the `theme/` folder (so `layout/`, `templates/`… are at the zip root) and upload in
  *Online Store → Themes → Add theme → Upload zip file*, or `shopify theme push --path theme --unpublished`.
- **Products / collections:** recreate with `productSet` / `collectionCreate` mutations from the JSONL.
  Product images are referenced by Shopify CDN URL (`media.nodes[].image.url`); download them separately if you
  need an offline copy, as the URLs stop working if the store is closed.

## Not included

Unpublished themes (18 others), pages, blog articles, navigation menus, discounts, files, metaobjects,
gift cards, and app data (Judge.me reviews, etc.).
