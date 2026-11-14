# Synthetic protocol fixtures

`lab-image.png` and `lab-image.jpg` are original generated 16×16 RGB images,
solid color (40, 100, 180), with no personal content or EXIF. They use the
project's MIT terms. Generated with Pillow's PNG default writer and JPEG quality
90, `exif=b''`. Pillow is not needed to run the harness; the committed bytes are
copied unchanged and hashed. Other fixtures are generated deterministically by
scripts/quickshare-lab/fixtures.cjs, with total generated data below 3 MiB.
