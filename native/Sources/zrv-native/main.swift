import AppKit
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Vision

enum Exit: Int32 {
    case ok = 0
    case usage = 1
    case inputMissing = 2
    case unavailable = 3
    case recognizeFailed = 4
    case unsupportedContainer = 5
}

struct BBox: Codable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

struct TextBlock: Codable {
    var text: String
    var confidence: Double
    var bbox: BBox
}

struct ImageResult: Codable {
    var ok: Bool
    var engine: String
    var task: String
    var text: String
    var blocks: [TextBlock]
    var ms: Int
    var error: String?
}

struct TranscriptLine: Codable {
    var t: Double
    var text: String
}

struct VideoResult: Codable {
    var ok: Bool
    var engine: String
    var task: String
    var text: String
    var transcript: [TranscriptLine]
    var framesExamined: Int
    var framesKept: Int
    var ms: Int
    var error: String?
}

struct Args {
    var command: String
    var input: String?
    var level: String = "accurate"
    var langs: [String] = ["en-US"]
    var json: Bool = true
    var mode: String = "scene"
    var interval: Double = 2
    var maxFrames: Int = 60
    var maxSeconds: Double = 180
}

func die(_ code: Exit, _ msg: String) -> Never {
    let payload = ["ok": false, "error": msg] as [String: Any]
    if let data = try? JSONSerialization.data(withJSONObject: payload) {
        FileHandle.standardError.write(data)
        FileHandle.standardError.write(Data("\n".utf8))
    } else {
        fputs(msg + "\n", stderr)
    }
    exit(code.rawValue)
}

func parseArgs() -> Args {
    var args = Args(command: "")
    let argv = Array(CommandLine.arguments.dropFirst())
    var i = 0
    while i < argv.count {
        let a = argv[i]
        switch a {
        case "ocr-image", "ocr-clipboard", "ocr-video":
            args.command = a
        case "--input":
            i += 1
            guard i < argv.count else { die(.usage, "missing --input") }
            args.input = argv[i]
        case "--level":
            i += 1
            guard i < argv.count else { die(.usage, "missing --level") }
            args.level = argv[i]
        case "--lang":
            i += 1
            guard i < argv.count else { die(.usage, "missing --lang") }
            if args.langs == ["en-US"] { args.langs = [] }
            args.langs.append(argv[i])
        case "--mode":
            i += 1
            guard i < argv.count else { die(.usage, "missing --mode") }
            args.mode = argv[i]
        case "--interval":
            i += 1
            guard i < argv.count else { die(.usage, "missing --interval") }
            args.interval = Double(argv[i]) ?? 2
        case "--max-frames":
            i += 1
            guard i < argv.count else { die(.usage, "missing --max-frames") }
            args.maxFrames = Int(argv[i]) ?? 60
        case "--json":
            args.json = true
        case "-h", "--help":
            fputs(
                "zrv-native ocr-image --input <path> [--level accurate|fast] [--lang en-US] --json\n"
                    + "zrv-native ocr-clipboard [--level accurate|fast] --json\n"
                    + "zrv-native ocr-video --input <path> [--mode scene|interval|all-idr] --json\n",
                stderr)
            exit(0)
        default:
            if args.input == nil, !a.hasPrefix("--"), args.command.isEmpty == false {
                args.input = a
            } else if args.command.isEmpty {
                die(.usage, "unknown argument: \(a)")
            }
        }
        i += 1
    }
    if args.command.isEmpty { die(.usage, "command required: ocr-image | ocr-clipboard | ocr-video") }
    return args
}

func emit<T: Encodable>(_ value: T) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    guard let data = try? enc.encode(value) else { die(.recognizeFailed, "json encode failed") }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func cgImageFromPDF(_ url: URL) -> CGImage? {
    guard let doc = PDFDocument(url: url), let page = doc.page(at: 0) else { return nil }
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2
    let size = CGSize(width: max(bounds.width * scale, 1), height: max(bounds.height * scale, 1))
    let img = page.thumbnail(of: size, for: .mediaBox)
    var rect = NSRect(origin: .zero, size: img.size)
    return img.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func cgImage(from url: URL) -> CGImage? {
    if let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    {
        return img
    }
    guard let ns = NSImage(contentsOf: url) else { return nil }
    var rect = NSRect(origin: .zero, size: ns.size)
    return ns.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func ocr(cgImage: CGImage, level: String, langs: [String]) throws -> [TextBlock] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = level == "fast" ? .fast : .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = langs
    if #available(macOS 13.0, *) {
        request.revision = VNRecognizeTextRequestRevision3
    }
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    guard let observations = request.results else { return [] }
    var blocks: [TextBlock] = []
    for obs in observations {
        guard let top = obs.topCandidates(1).first else { continue }
        let bb = obs.boundingBox
        blocks.append(
            TextBlock(
                text: top.string,
                confidence: Double(top.confidence),
                bbox: BBox(x: bb.origin.x, y: bb.origin.y, w: bb.size.width, h: bb.size.height)
            ))
    }
    return blocks
}

func ocrFile(path: String, level: String, langs: [String]) -> ImageResult {
    let t0 = Date()
    if path == "-" {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        if data.count > 30 * 1024 * 1024 {
            return ImageResult(
                ok: false, engine: "apple-vision", task: "transcribe", text: "", blocks: [],
                ms: 0, error: "input exceeds 30 MB")
        }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bin")
        try? data.write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        return ocrFile(path: tmp.path, level: level, langs: langs)
    }
    let url = URL(fileURLWithPath: path)
    guard FileManager.default.isReadableFile(atPath: url.path) else {
        return ImageResult(
            ok: false, engine: "apple-vision", task: "transcribe", text: "", blocks: [], ms: 0,
            error: "input missing")
    }
    let img: CGImage?
    if url.pathExtension.lowercased() == "pdf" {
        img = cgImageFromPDF(url)
    } else {
        img = cgImage(from: url)
    }
    guard let img else {
        return ImageResult(
            ok: false, engine: "apple-vision", task: "transcribe", text: "", blocks: [], ms: 0,
            error: "could not decode image")
    }
    do {
        let blocks = try ocr(cgImage: img, level: level, langs: langs)
        let text = blocks.map(\.text).joined(separator: "\n")
        return ImageResult(
            ok: true, engine: "apple-vision", task: "transcribe", text: text, blocks: blocks,
            ms: Int(Date().timeIntervalSince(t0) * 1000), error: nil)
    } catch {
        return ImageResult(
            ok: false, engine: "apple-vision", task: "transcribe", text: "", blocks: [],
            ms: Int(Date().timeIntervalSince(t0) * 1000), error: error.localizedDescription)
    }
}

func clipboardImage() -> CGImage? {
    let pb = NSPasteboard.general
    if let data = pb.data(forType: .png) ?? pb.data(forType: .tiff) {
        if let src = CGImageSourceCreateWithData(data as CFData, nil) {
            return CGImageSourceCreateImageAtIndex(src, 0, nil)
        }
    }
    if let img = pb.readObjects(forClasses: [NSImage.self], options: nil)?.first as? NSImage {
        var rect = NSRect(origin: .zero, size: img.size)
        return img.cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }
    return nil
}

func dHash64(_ image: CGImage) -> UInt64 {
    let w = 9
    let h = 8
    guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { return 0 }
    ctx.interpolationQuality = .low
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let data = ctx.data else { return 0 }
    let buf = data.bindMemory(to: UInt8.self, capacity: w * h)
    var hash: UInt64 = 0
    var bit: UInt64 = 1
    for y in 0..<h {
        for x in 0..<(w - 1) {
            let a = buf[y * w + x]
            let b = buf[y * w + x + 1]
            if a > b { hash |= bit }
            bit <<= 1
        }
    }
    return hash
}

func hamming(_ a: UInt64, _ b: UInt64) -> Int {
    Int((a ^ b).nonzeroBitCount)
}

func normalizeText(_ s: String) -> String {
    s.lowercased().split { $0.isWhitespace }.joined(separator: " ")
}

func ocrVideo(path: String, args: Args) -> VideoResult {
    let t0 = Date()
    let url = URL(fileURLWithPath: path)
    let asset = AVURLAsset(url: url)
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero

    let duration = CMTimeGetSeconds(asset.duration)
    if duration.isNaN || duration <= 0 {
        return VideoResult(
            ok: false, engine: "apple-vision", task: "transcribe", text: "", transcript: [],
            framesExamined: 0, framesKept: 0, ms: 0, error: "unsupported container")
    }
    let capSeconds = min(duration, args.maxSeconds)
    let maxFrames = min(max(args.maxFrames, 1), 200)

    var times: [Double] = []
    switch args.mode {
    case "interval":
        var t = 0.0
        while t <= capSeconds {
            times.append(t)
            t += max(args.interval, 0.2)
        }
        if times.last != capSeconds { times.append(capSeconds) }
    case "all-idr":
        // Sample at 1 fps as a stand-in for IDR when track metadata is thin.
        var t = 0.0
        while t <= capSeconds {
            times.append(t)
            t += 1
        }
    default:
        var t = 0.0
        while t <= capSeconds {
            times.append(t)
            t += 0.5
        }
        if times.last != capSeconds { times.append(capSeconds) }
    }

    var examined = 0
    var kept: [(Double, String, UInt64)] = []
    var lastHash: UInt64?
    var lastNorm = ""

    for t in times {
        if kept.count >= maxFrames { break }
        examined += 1
        let cm = CMTime(seconds: t, preferredTimescale: 600)
        var actual = CMTime.zero
        let cg: CGImage
        do {
            cg = try gen.copyCGImage(at: cm, actualTime: &actual)
        } catch {
            continue
        }
        let hash = dHash64(cg)
        let isKey = kept.isEmpty || t == times.last
        if let prev = lastHash, !isKey, args.mode == "scene", hamming(prev, hash) <= 10 {
            continue
        }
        do {
            let blocks = try ocr(cgImage: cg, level: args.level, langs: args.langs)
            let text = blocks.map(\.text).joined(separator: "\n")
            let norm = normalizeText(text)
            if !isKey, !norm.isEmpty, norm == lastNorm { continue }
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !isKey { continue }
            kept.append((CMTimeGetSeconds(actual), text, hash))
            lastHash = hash
            if !norm.isEmpty { lastNorm = norm }
        } catch {
            continue
        }
    }

    if kept.count > maxFrames {
        let first = kept.first!
        let last = kept.last!
        let mid = kept.dropFirst().dropLast()
        let step = max(Double(mid.count) / Double(maxFrames - 2), 1)
        var slim: [(Double, String, UInt64)] = [first]
        var acc = 0.0
        for row in mid {
            if Double(slim.count - 1) >= Double(maxFrames - 2) { break }
            if acc <= 0 {
                slim.append(row)
                acc += step
            }
            acc -= 1
        }
        slim.append(last)
        kept = slim
    }

    let transcript = kept.map { TranscriptLine(t: $0.0, text: $0.1) }
    let text = transcript.map { String(format: "[%02d:%02d] %@", Int($0.t) / 60, Int($0.t) % 60, $0.text) }
        .joined(separator: "\n")
    return VideoResult(
        ok: true, engine: "apple-vision", task: "transcribe", text: text, transcript: transcript,
        framesExamined: examined, framesKept: kept.count,
        ms: Int(Date().timeIntervalSince(t0) * 1000), error: nil)
}

let args = parseArgs()
switch args.command {
case "ocr-image":
    guard let input = args.input else { die(.usage, "--input required") }
    let result = ocrFile(path: input, level: args.level, langs: args.langs)
    emit(result)
    exit(result.ok ? 0 : (result.error == "input missing" ? 2 : 4))
case "ocr-clipboard":
    let t0 = Date()
    guard let img = clipboardImage() else {
        emit(
            ImageResult(
                ok: false, engine: "apple-vision", task: "transcribe", text: "", blocks: [], ms: 0,
                error: "clipboard has no image"))
        exit(2)
    }
    do {
        let blocks = try ocr(cgImage: img, level: args.level, langs: args.langs)
        emit(
            ImageResult(
                ok: true, engine: "apple-vision", task: "transcribe",
                text: blocks.map(\.text).joined(separator: "\n"), blocks: blocks,
                ms: Int(Date().timeIntervalSince(t0) * 1000), error: nil))
        exit(0)
    } catch {
        emit(
            ImageResult(
                ok: false, engine: "apple-vision", task: "transcribe", text: "", blocks: [],
                ms: Int(Date().timeIntervalSince(t0) * 1000), error: error.localizedDescription))
        exit(4)
    }
case "ocr-video":
    guard let input = args.input else { die(.usage, "--input required") }
    guard FileManager.default.isReadableFile(atPath: input) else { die(.inputMissing, "input missing") }
    let result = ocrVideo(path: input, args: args)
    emit(result)
    exit(result.ok ? 0 : 5)
default:
    die(.usage, "unknown command")
}
