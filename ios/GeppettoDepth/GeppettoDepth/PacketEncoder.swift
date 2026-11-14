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

/// Grey depth preview: near is bright, 0.2 m to 2 m, no reading is black.
enum DepthPreview {
    static func image(_ pb: CVPixelBuffer) -> UIImage? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
        var px = [UInt8](repeating: 0, count: w * h)
        for y in 0..<h {
            let row = base.advanced(by: y * bpr).assumingMemoryBound(to: Float32.self)
            for x in 0..<w {
                let d = row[x]
                if d.isFinite && d > 0 {
                    let n = 1 - min(max((d - 0.2) / 1.8, 0), 1)
                    px[y * w + x] = UInt8(40 + n * 215)
                }
            }
        }
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w,
                               space: CGColorSpaceCreateDeviceGray(),
                               bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return nil }
        return UIImage(cgImage: cg)
    }
}
