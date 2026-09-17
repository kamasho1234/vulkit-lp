# VB108 review update record — v115

This branch is a change record, not a deployable snapshot of the current site.
Do not merge or deploy this old repository tree as production: its base predates
the live VB108 checkout and fulfillment services. Git-triggered deployment is
disabled for this branch only; production configuration is unchanged.

The live update is built separately from the verified current production source
manifest: 513 existing files, with only VB108/index.html and VB108/styles.css
changed and 14 responsive WebP images added (527 final files). All 27 existing
API runtime contracts and all other production source files are preserved.

Amazon source: 24 supplied reviews. The operator explicitly chose to exclude
15 reviews already present via vulkit.com, including all media on those repeated
reviews. Only Amazon indices 01–09 are added. No original data is edited.

- Final reviews: 29 (20 existing + 9 new).
- Ratings: 21 five-star, 8 four-star; sum 137; mean 4.724137931; displayed 4.72.
- Product JSON-LD: ratingValue 4.72, reviewCount 29.
- New media: 7 unique photos, 14 WebP files. No new video: its owning review was excluded.
- Total published review media: 35 photos and 6 original videos.
- Amazon country/source labels, 8 verified-purchase badges and 1 Vine disclosure added.

Public URL: https://vulkit.kamacrafy.com/VB108/#reviews

Reproducible translation/deduplication scripts, full 24-review before/after table,
source hash audit, verification report and visual QA screenshots are retained in
the source workspace under work/vb108-amazon-reviews-v115/.
