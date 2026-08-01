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
# ZIP entry names. The whole name is bounded to allow nested directory
# structures; each path component is bounded by what a filesystem will take.
MAX_ENTRY_NAME_LENGTH = 4096
MAX_ENTRY_COMPONENT_LENGTH = 255

# Stylesheets. Parsing is by far the most expensive thing the validator does,
# and it is pure Python. A multi-megabyte stylesheet inside an archive that is
# under every other cap is a denial of service, not a theme, so the parser is
# never handed one.
MAX_CSS_BYTES = 256 * 1024

# One hostile stylesheet can produce one issue per declaration. Collecting them
# all costs more memory than the archive did and renders a message no author
# would read, so collection stops here and says that it did.
MAX_ISSUES = 200

# Preview screenshots.
MAX_PREVIEWS = 8
MAX_PREVIEW_BYTES = 2 * 1024 * 1024
MAX_PREVIEW_EDGE_PX = 2560

# Per-account quotas, enforced in stage 2 but declared here so there is one home.
MAX_THEMES_PER_ACCOUNT = 20
MAX_ACCOUNT_BYTES = 200 * 1024 * 1024

# theme_id is author-chosen and becomes a directory name, so it is bounded.
MAX_THEME_ID_LENGTH = 64

# Free text from the manifest. Stage 2 puts these in database columns and
# stage 3 renders them, so they are bounded at the point they are parsed
# rather than at the point they are stored.
MAX_NAME_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 500
MAX_CAPTION_LENGTH = 120
MAX_URL_LENGTH = 300

# How far into a file the SVG sniffer looks for the root element. A file with
# <svg> buried past this is not an SVG worth accepting.
MAX_SVG_SNIFF_BYTES = 1024

# How much of an unexpected exception's text reaches the author. Enough to
# recognise, not enough to leak a path or a stack fragment into the UI.
MAX_ERROR_DETAIL_CHARS = 100
