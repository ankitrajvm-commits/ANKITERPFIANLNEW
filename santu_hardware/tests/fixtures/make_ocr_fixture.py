"""Build the OCR test bill: a picture of a 3-line supplier bill, saved as a
PNG and as an image-only PDF (no text layer, like a real scan).

It lives next to the tests because the first copy sat in a session
scratchpad and vanished, and the three OCR checks then failed with "0 of 0"
for reasons that had nothing to do with the app (2026-09-10).

Rates are 20 / 30 / 225 and every amount differs from its rate, so a parser
that takes the amount instead of the rate is caught.
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PNG = os.path.join(HERE, "ocr_bill.png")
PDF = os.path.join(HERE, "ocr_bill.pdf")

LINES = [
	"GUPTA PIPE TRADERS",
	"Sl  Particulars                        Qty       Rate      Amount",
	'1   PRINCE CPVC HAF ELBOW 1"           10 Pcs    20.00     200.00',
	'2   SUPREME CPVC HAF ELBOW 3/4"         5 Pcs    30.00     150.00',
	'3   PRINCE CPVC BALL VALVE 1"           2 Pcs   225.00     450.00',
	"Grand Total                                               800.00",
]


def build():
	font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Courier New.ttf", 34)
	img = Image.new("RGB", (1700, 120 + 70 * len(LINES)), "white")
	draw = ImageDraw.Draw(img)
	for i, line in enumerate(LINES):
		draw.text((60, 60 + 70 * i), line, fill="black", font=font)
	img.save(PNG)
	img.save(PDF, "PDF", resolution=200)  # image only -- no text layer
	return PNG, PDF


if __name__ == "__main__":
	print(build())
