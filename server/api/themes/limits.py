"""Every numeric cap for theme packages, in one place.

Starting values, chosen so a rich theme fits comfortably and a hostile one does
not. They are here rather than scattered through the validator so that raising
one is a single reviewed edit.
"""

# Archive shape, checked from the ZIP central directory before anything is read.
MAX_ENTRIES = 200
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
# A single entry expanding more than this is a zip bomb regardless of totals.
MAX_EXPANSION_RATIO = 100

# Preview screenshots.
MAX_PREVIEWS = 8
MAX_PREVIEW_BYTES = 2 * 1024 * 1024
MAX_PREVIEW_EDGE_PX = 2560

# Per-account quotas, enforced in stage 2 but declared here so there is one home.
MAX_THEMES_PER_ACCOUNT = 20
MAX_ACCOUNT_BYTES = 200 * 1024 * 1024

# theme_id is author-chosen and becomes a directory name, so it is bounded.
MAX_THEME_ID_LENGTH = 64
