// santu_ocr — text out of an image or a PDF page, using macOS's own Vision
// engine.
//
// Why not tesseract (which is installed): Vision is Apple's production OCR,
// it is already on this Mac, needs no language data files, no network, and on
// phone-camera photos of a supplier's bill it is markedly better at skewed,
// shadowed and low-contrast text — which is exactly what a bill photographed
// at the counter looks like. tesseract stays as the fallback in ocr_service.py
// for the case where this binary is missing or refuses a file.
//
// Usage:  santu_ocr <file> [<file> ...]
// Prints the recognised text, one line per observation, in reading order.
// PDFs are rasterised page by page; a page break is marked with \f.

import Foundation
import Vision
import AppKit
import CoreGraphics
import PDFKit

func recognise(cgImage: CGImage) -> [String] {
    let request = VNRecognizeTextRequest()
    // .accurate over .fast: this runs once per uploaded bill, not per frame,
    // and a wrong rate on an item is far more expensive than a second of CPU.
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-IN", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do { try handler.perform([request]) } catch { return [] }
    guard let obs = request.results else { return [] }

    // Vision returns observations in no particular order. A bill is read
    // top-to-bottom, left-to-right, so sort by row band first (bounding boxes
    // are normalised with the origin at the BOTTOM-left, hence the flip) and
    // then by x — otherwise an item name and its rate arrive shuffled and the
    // row parser downstream has nothing to work with.
    let items: [(y: CGFloat, x: CGFloat, text: String)] = obs.compactMap {
        guard let top = $0.topCandidates(1).first else { return nil }
        return (1 - $0.boundingBox.midY, $0.boundingBox.minX, top.string)
    }
    let rowTolerance: CGFloat = 0.012
    var lines: [String] = []
    var current: [(x: CGFloat, text: String)] = []
    var currentY: CGFloat = -1
    for it in items.sorted(by: { $0.y == $1.y ? $0.x < $1.x : $0.y < $1.y }) {
        if currentY < 0 || abs(it.y - currentY) <= rowTolerance {
            current.append((it.x, it.text))
            if currentY < 0 { currentY = it.y }
        } else {
            lines.append(current.sorted { $0.x < $1.x }.map(\.text).joined(separator: "  "))
            current = [(it.x, it.text)]
            currentY = it.y
        }
    }
    if !current.isEmpty {
        lines.append(current.sorted { $0.x < $1.x }.map(\.text).joined(separator: "  "))
    }
    return lines
}

func pages(of url: URL) -> [CGImage] {
    if url.pathExtension.lowercased() == "pdf" {
        guard let doc = PDFDocument(url: url) else { return [] }
        var out: [CGImage] = []
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            // ~200 dpi. Below about 150 the small type on a rate card starts
            // dropping characters; above 300 it only costs time.
            let scale: CGFloat = 200.0 / 72.0
            let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
            let image = NSImage(size: size)
            image.lockFocus()
            NSColor.white.setFill()
            NSRect(origin: .zero, size: size).fill()
            if let ctx = NSGraphicsContext.current?.cgContext {
                ctx.scaleBy(x: scale, y: scale)
                page.draw(with: .mediaBox, to: ctx)
            }
            image.unlockFocus()
            if let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) { out.append(cg) }
        }
        return out
    }
    guard let image = NSImage(contentsOf: url),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
    return [cg]
}

let files = Array(CommandLine.arguments.dropFirst())
if files.isEmpty {
    FileHandle.standardError.write("usage: santu_ocr <file> [<file> ...]\n".data(using: .utf8)!)
    exit(2)
}
var produced = false
for path in files {
    let imgs = pages(of: URL(fileURLWithPath: path))
    if imgs.isEmpty {
        FileHandle.standardError.write("could not read \(path)\n".data(using: .utf8)!)
        continue
    }
    for (idx, img) in imgs.enumerated() {
        if idx > 0 { print("\u{0C}") }
        let lines = recognise(cgImage: img)
        if !lines.isEmpty { produced = true }
        for l in lines { print(l) }
    }
}
exit(produced ? 0 : 1)
