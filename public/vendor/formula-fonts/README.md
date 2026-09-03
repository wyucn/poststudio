# Formula fonts

The two WOFF2 files in this directory are STIX Two Text and STIX Two Math
regular fonts from the STIX Fonts Project. They are distributed under the SIL
Open Font License 1.1; the complete license is in `OFL-1.1-STIX.txt`.

The formula renderer uses the MathJax STIX2 SVG bundle for mathematical
outlines. These WOFF2 assets provide a redistributable text fallback and are
also embedded into exported SVG files as data URLs.

`方正兰亭圆简体` is intentionally not copied here: it is loaded from a user's
installed fonts through the browser Local Font Access API after explicit user
permission, and is embedded only in that user's export.
