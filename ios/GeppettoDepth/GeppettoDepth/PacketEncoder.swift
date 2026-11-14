import Accelerate
import ARKit
import CoreImage
import UIKit

/// Wire constants. The layout is documented byte by byte in ios/PROTOCOL.md; keep both in step.
enum DepthProtocol {
    static let port: UInt16 = 7700
    static let magic: [UInt8] = Array("GDP1".utf8)
    static let version: UInt16 = 1
    static let headerSize = 216
    static let flagPlane: UInt16 = 1 << 0
    static let flagConfidence: UInt16 = 1 << 1
    static let jpegWidth: CGFloat = 640
    static let jpegQuality: CGFloat = 0.6
    /// 30 Hz with a little slack, so a 60 Hz camera sends every second frame.
    static let minInterval: TimeInterval = 1.0 / 30.0 - 0.005
}

/// Little-endian writer.
struct ByteWriter {
    var data: Data

    init(capacity: Int) { data = Data(capacity: capacity) }

    mutating func u8(_ v: UInt8) { data.append(v) }
    mutating func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
    mutating func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
    mutating func f32(_ v: Float) { u32(v.bitPattern) }
    mutating func f64(_ v: Double) { withUnsafeBytes(of: v.bitPattern.littleEndian) { data.append(contentsOf: $0) } }

    /// Row-major. simd matrices are column-major: m[column][row].
    mutating func mat3(_ m: simd_float3x3) {
        for r in 0..<3 { for c in 0..<3 { f32(m[c][r]) } }
    }

    mutating func mat4(_ m: simd_float4x4) {
        for r in 0..<4 { for c in 0..<4 { f32(m[c][r]) } }
    }
}

final class PacketEncoder {
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    /// One packet: 8-byte prefix, 216-byte header, float16 depth, uint8 confidence, JPEG.
    func encode(frame: ARFrame, depth: ARDepthData, frameId: UInt32) -> Data? {
        guard let (depthBytes, dw, dh) = Self.float16(depth.depthMap) else { return nil }
        let conf = depth.confidenceMap.flatMap { Self.bytes8($0) }
        guard let (jpeg, jw, jh) = jpeg(frame.capturedImage) else { return nil }
        let res = frame.camera.imageResolution
        let plane = Self.largestHorizontalPlane(frame.anchors, cameraY: frame.camera.transform.columns.3.y)
        var flags: UInt16 = 0
        if plane != nil { flags |= DepthProtocol.flagPlane }
        if conf != nil { flags |= DepthProtocol.flagConfidence }

        var h = ByteWriter(capacity: DepthProtocol.headerSize)
        h.u16(DepthProtocol.version)
        h.u16(flags)
        h.u32(frameId)
        h.f64(frame.timestamp)
        h.u16(UInt16(dw))
        h.u16(UInt16(dh))
        h.u16(UInt16(jw))
        h.u16(UInt16(jh))
        h.u16(UInt16(res.width))
        h.u16(UInt16(res.height))
        h.u32(UInt32(depthBytes.count))
        h.u32(UInt32(conf?.count ?? 0))
        h.u32(UInt32(jpeg.count))
        h.mat3(frame.camera.intrinsics)
        h.mat4(frame.camera.transform)
        h.mat4(plane?.pose ?? matrix_identity_float4x4)
        h.f32(plane?.extent.x ?? 0)
        h.f32(plane?.extent.y ?? 0)
        h.u8(Self.trackingCode(frame.camera.trackingState))
        h.u8(0); h.u8(0); h.u8(0)
        precondition(h.data.count == DepthProtocol.headerSize, "header size \(h.data.count)")

        let payloadLength = h.data.count + depthBytes.count + (conf?.count ?? 0) + jpeg.count
        var out = ByteWriter(capacity: 8 + payloadLength)
        out.data.append(contentsOf: DepthProtocol.magic)
        out.u32(UInt32(payloadLength))
        out.data.append(h.data)
        out.data.append(depthBytes)
        if let conf { out.data.append(conf) }
        out.data.append(jpeg)
        return out.data
    }

    /// The bench: the highest horizontal plane that faces up, lies below the camera and is at
    /// least 0.04 m2, so a ceiling (normal down) or the floor (lower) does not win. Falls back to
    /// the largest horizontal plane of any kind. Pose moved to the plane centre and turned by
    /// rotationOnYAxis.
    static func largestHorizontalPlane(_ anchors: [ARAnchor], cameraY: Float = .greatestFiniteMagnitude)
        -> (pose: simd_float4x4, extent: SIMD2<Float>)? {
        var best: ARPlaneAnchor?
        var bestY: Float = -.greatestFiniteMagnitude
        var largest: ARPlaneAnchor?
        var largestArea: Float = 0
        for case let p as ARPlaneAnchor in anchors where p.alignment == .horizontal {
            let area = p.planeExtent.width * p.planeExtent.height
            if area > largestArea {
                largest = p
                largestArea = area
            }
            let facesUp = p.transform.columns.1.y > 0
            let y = p.transform.columns.3.y + p.center.y
            if facesUp && y < cameraY && area >= 0.04 && y > bestY {
                best = p
                bestY = y
            }
        }
        guard let p = best ?? largest else { return nil }
        var centre = matrix_identity_float4x4
        centre.columns.3 = SIMD4<Float>(p.center.x, p.center.y, p.center.z, 1)
        let turn = simd_float4x4(simd_quatf(angle: p.planeExtent.rotationOnYAxis, axis: SIMD3<Float>(0, 1, 0)))
        return (p.transform * centre * turn, SIMD2<Float>(p.planeExtent.width, p.planeExtent.height))
    }

    // MARK: pieces

    /// DepthFloat32 metres to float16, row by row, padding removed.
    static func float16(_ pb: CVPixelBuffer) -> (Data, Int, Int)? {
        guard CVPixelBufferGetPixelFormatType(pb) == kCVPixelFormatType_DepthFloat32 else { return nil }
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        var out = Data(count: w * h * 2)
        let err: vImage_Error = out.withUnsafeMutableBytes { raw in
            var src = vImage_Buffer(data: base, height: vImagePixelCount(h), width: vImagePixelCount(w),
                                    rowBytes: CVPixelBufferGetBytesPerRow(pb))
            var dst = vImage_Buffer(data: raw.baseAddress, height: vImagePixelCount(h), width: vImagePixelCount(w),
                                    rowBytes: w * 2)
            return vImageConvert_PlanarFtoPlanar16F(&src, &dst, vImage_Flags(kvImageNoFlags))
        }
        return err == kvImageNoError ? (out, w, h) : nil
    }

    /// OneComponent8 confidence (ARConfidenceLevel 0, 1, 2), padding removed.
    static func bytes8(_ pb: CVPixelBuffer) -> Data? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
        var out = Data(capacity: w * h)
        for y in 0..<h {
            out.append(base.advanced(by: y * bpr).assumingMemoryBound(to: UInt8.self), count: w)
        }
        return out
    }

    /// The camera image scaled to 640 wide, as JPEG.
    func jpeg(_ pb: CVPixelBuffer) -> (Data, Int, Int)? {
        let image = CIImage(cvPixelBuffer: pb)
        let scale = DepthProtocol.jpegWidth / image.extent.width
        let small = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let w = Int((image.extent.width * scale).rounded()), h = Int((image.extent.height * scale).rounded())
        let options: [CIImageRepresentationOption: Any] = [
            CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): DepthProtocol.jpegQuality
        ]
        guard let data = context.jpegRepresentation(of: small, colorSpace: colorSpace, options: options) else { return nil }
        return (data, w, h)
    }

    static func trackingCode(_ s: ARCamera.TrackingState) -> UInt8 {
        switch s {
        case .notAvailable: return 0
        case .limited: return 1
        case .normal: return 2
        }
    }
}

/// Colour depth preview: 0.2 m (blue) to 1.5 m (red) through a Turbo-like ramp, no reading is black.
/// Pixels whose confidence is low are drawn at 40 % brightness, so black fabric and far walls look dim.
enum DepthPreview {
    static let near: Float = 0.2
    static let far: Float = 1.5
    /// 256-entry RGB ramp: dark blue, cyan, green, yellow, red (a cheap Turbo).
    static let lut: [(UInt8, UInt8, UInt8)] = (0..<256).map { i in
        let t = Float(i) / 255
        let stops: [(Float, Float, Float, Float)] = [
            (0.00, 0.19, 0.07, 0.23), (0.13, 0.27, 0.32, 0.81), (0.25, 0.08, 0.59, 0.93),
            (0.38, 0.16, 0.83, 0.65), (0.50, 0.60, 0.98, 0.27), (0.63, 0.92, 0.88, 0.17),
            (0.75, 0.99, 0.64, 0.16), (0.88, 0.92, 0.31, 0.08), (1.00, 0.48, 0.02, 0.01)]
        var k = 0
        while k + 1 < stops.count - 1 && t > stops[k + 1].0 { k += 1 }
        let a = stops[k], b = stops[k + 1]
        let f = max(0, min(1, (t - a.0) / max(b.0 - a.0, 1e-6)))
        return (UInt8((a.1 + (b.1 - a.1) * f) * 255), UInt8((a.2 + (b.2 - a.2) * f) * 255), UInt8((a.3 + (b.3 - a.3) * f) * 255))
    }

    static func image(_ pb: CVPixelBuffer, confidence: CVPixelBuffer? = nil) -> UIImage? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
        var confBase: UnsafeMutableRawPointer?
        var confBpr = 0
        if let c = confidence, CVPixelBufferGetWidth(c) == w, CVPixelBufferGetHeight(c) == h {
            CVPixelBufferLockBaseAddress(c, .readOnly)
            confBase = CVPixelBufferGetBaseAddress(c)
            confBpr = CVPixelBufferGetBytesPerRow(c)
        }
        defer { if let c = confidence, confBase != nil { CVPixelBufferUnlockBaseAddress(c, .readOnly) } }
        var px = [UInt8](repeating: 0, count: w * h * 4)
        for y in 0..<h {
            let row = base.advanced(by: y * bpr).assumingMemoryBound(to: Float32.self)
            let crow = confBase?.advanced(by: y * confBpr).assumingMemoryBound(to: UInt8.self)
            for x in 0..<w {
                let d = row[x]
                let o = (y * w + x) * 4
                px[o + 3] = 255
                guard d.isFinite && d > 0 else { continue }
                let n = min(max((d - near) / (far - near), 0), 1)
                var (r, g, b) = lut[Int(n * 255)]
                if let crow = crow, crow[x] == 0 {
                    r = UInt8(Float(r) * 0.4); g = UInt8(Float(g) * 0.4); b = UInt8(Float(b) * 0.4)
                }
                px[o] = r; px[o + 1] = g; px[o + 2] = b
            }
        }
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                               space: CGColorSpaceCreateDeviceRGB(),
                               bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
        else { return nil }
        return UIImage(cgImage: cg)
    }
}
