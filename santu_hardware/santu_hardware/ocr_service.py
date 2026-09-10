"""Reading text off things that have no text in them — scanned bills, phone
photos of a supplier's rate card, image-only PDFs.

Until now every import path in this app assumed a PDF carried real text.
`extract_items_from_pdf` walked three parsers and then gave up with "scanned
photo PDF ke liye Excel import use karein" — which is no answer at all when
what the shop actually has is a photo of a mahajan's bill (2026-09-05
request: "import item ke pdf, excel, sabme best ocr setup kr do").

Two engines, deliberately in this order:

1. **macOS Vision** (`scripts/ocr/santu_ocr`, a small Swift binary). Apple's
   own production OCR: already on this Mac, no language packs, no network,
   and clearly better than tesseract on the skewed, shadowed, low-contrast
   text of a bill photographed at a counter. It also returns observations in
   READING ORDER — item name and its rate stay on one line, which is the
   whole reason the row parsers downstream can do anything with the output.
2. **tesseract** (installed via brew), for when the binary is missing or
   refuses a file. It needs the page rasterised first, which pdftoppm does.

Neither ever leaves this Mac. Nothing here uploads a bill anywhere.
"""

import os
import shutil
import subprocess

import frappe

# The Swift binary lives with the app, not on PATH — built from
# scripts/ocr/santu_ocr.swift, part of this repo.
#
# Looked for in several places on purpose: this repo is checked out twice on
# this machine (the working copy, and the clone bench actually runs from),
# and `scripts/` sits at the repo root while this module sits three levels
# down inside the package. Guessing one path silently fell back to tesseract
# without anyone noticing which engine had run (2026-09-05).
def _candidate_binaries():
	here = os.path.abspath(__file__)
	app_root = os.path.dirname(os.path.dirname(os.path.dirname(here)))
	return [
		os.path.join(app_root, "scripts", "ocr", "santu_ocr"),
		os.path.join(os.path.dirname(app_root), "scripts", "ocr", "santu_ocr"),
		"/Users/santuhardware/erpnext/scripts/ocr/santu_ocr",
	]

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".heic", ".tif", ".tiff", ".bmp", ".webp")


def ocr_available() -> bool:
	"""Whether anything on this machine can read an image at all."""
	return bool(_vision_binary() or shutil.which("tesseract"))


def _vision_binary():
	for path in _candidate_binaries():
		if os.path.exists(path) and os.access(path, os.X_OK):
			return path
	return None


def ocr_file(path: str, timeout: int = 180) -> str:
	"""Text out of one image or PDF. Empty string when nothing could be read.

	Never raises for an unreadable file — a caller that has already tried
	three text parsers wants an answer or an empty string, not a fourth kind
	of failure to handle.
	"""
	if not path or not os.path.exists(path):
		return ""

	text = _run_vision(path, timeout)
	if text.strip():
		return text
	return _run_tesseract(path, timeout)


def _run_vision(path: str, timeout: int) -> str:
	binary = _vision_binary()
	if not binary:
		return ""
	try:
		out = subprocess.run(
			[binary, path], capture_output=True, text=True, timeout=timeout, check=False
		)
		return out.stdout or ""
	except (subprocess.TimeoutExpired, OSError):
		# A hung OCR must never hold an import request open — the caller
		# falls through to tesseract, and then to "could not read this".
		return ""


def _run_tesseract(path: str, timeout: int) -> str:
	if not shutil.which("tesseract"):
		return ""
	pages = [path]
	tmpdir = None
	if path.lower().endswith(".pdf"):
		if not shutil.which("pdftoppm"):
			return ""
		import tempfile

		tmpdir = tempfile.mkdtemp(prefix="santu_ocr_")
		try:
			subprocess.run(
				["pdftoppm", "-png", "-r", "200", path, os.path.join(tmpdir, "page")],
				capture_output=True,
				timeout=timeout,
				check=False,
			)
		except (subprocess.TimeoutExpired, OSError):
			shutil.rmtree(tmpdir, ignore_errors=True)
			return ""
		pages = sorted(
			os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith(".png")
		)

	chunks = []
	try:
		for page in pages:
			try:
				out = subprocess.run(
					["tesseract", page, "stdout", "--psm", "6"],
					capture_output=True,
					text=True,
					timeout=timeout,
					check=False,
				)
				if out.stdout:
					chunks.append(out.stdout)
			except (subprocess.TimeoutExpired, OSError):
				continue
	finally:
		if tmpdir:
			shutil.rmtree(tmpdir, ignore_errors=True)
	return "\n\f\n".join(chunks)


def resolve_upload_path(file_url: str) -> str:
	"""Local path for an uploaded File, private or public."""
	if not file_url:
		return ""
	if os.path.isabs(file_url) and os.path.exists(file_url):
		return file_url
	site_path = frappe.get_site_path()
	rel = file_url.split("?")[0]
	candidate = os.path.join(site_path, rel.lstrip("/"))
	if os.path.exists(candidate):
		return candidate
	# Frappe stores private files under <site>/private/files and serves them
	# as /private/files/... — public ones as /files/... but live in
	# <site>/public/files. That second mapping is the one a naive join misses.
	for prefix, real in (("/files/", "public/files/"), ("/private/files/", "private/files/")):
		if rel.startswith(prefix):
			p = os.path.join(site_path, real + rel[len(prefix):])
			if os.path.exists(p):
				return p
	return ""
