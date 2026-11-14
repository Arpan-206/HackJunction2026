import ARKit
import Combine
import UIKit

/// Runs ARKit (world tracking, LiDAR scene depth, horizontal planes, gravity aligned) and
/// sends one packet per frame at up to 30 Hz to the connected Mac.
final class DepthStreamer: NSObject, ObservableObject, ARSessionDelegate {
    // UI state, main thread only
    @Published var preview: UIImage?
    @Published var connection = "starting"
    @Published var clientConnected = false
    @Published var arFPS = 0.0
    @Published var sentFPS = 0.0
    @Published var sent = 0
    @Published var dropped = 0
    @Published var tracking = "-"
    @Published var planeText = "not found yet"
    @Published var unsupported = false

    private let session = ARSession()
    private let server = FrameServer(port: DepthProtocol.port)
    private let encoder = PacketEncoder()
    private let frameQueue = DispatchQueue(label: "geppetto.depth.frames", qos: .userInteractive)

    // frame queue only
    private var lastSent: TimeInterval = 0
    private var frameId: UInt32 = 0
    private var arTimes: [TimeInterval] = []
    private var sentTimes: [TimeInterval] = []
    private var sentCount = 0
    private var droppedCount = 0
    private var lastUI: TimeInterval = 0
    private var lastPreview: TimeInterval = 0

    private var serverStarted = false

    func start() {
        guard ARWorldTrackingConfiguration.isSupported,
              ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            unsupported = true
            connection = "no LiDAR depth on this device"
            return
        }
        if !serverStarted {
            serverStarted = true
            server.onState = { [weak self] text, connected in
                DispatchQueue.main.async {
                    self?.connection = text
                    self?.clientConnected = connected
                }
            }
            session.delegate = self
            session.delegateQueue = frameQueue
        }
        server.ensureListening()
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = [.sceneDepth]
        config.planeDetection = [.horizontal]
        config.worldAlignment = .gravity
        session.run(config)
    }

    // MARK: ARSessionDelegate (on frameQueue)

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let t = frame.timestamp
        arTimes.append(t)
        if arTimes.count > 61 { arTimes.removeFirst(arTimes.count - 61) }

        if let depth = frame.sceneDepth, t - lastSent >= DepthProtocol.minInterval {
            if server.hasClient {
                if server.isIdle {
                    lastSent = t
                    frameId &+= 1
                    if let packet = encoder.encode(frame: frame, depth: depth, frameId: frameId), server.send(packet) {
                        sentCount += 1
                        sentTimes.append(t)
                        if sentTimes.count > 31 { sentTimes.removeFirst(sentTimes.count - 31) }
                    }
                } else {
                    droppedCount += 1           // the previous frame is still in flight: skip, stay fresh
                }
            } else {
                lastSent = t
            }
        }

        if t - lastPreview >= 0.1, let depth = frame.sceneDepth {
            lastPreview = t
            let img = DepthPreview.image(depth.depthMap)
            DispatchQueue.main.async { self.preview = img }
        }

        if t - lastUI >= 0.25 {
            lastUI = t
            let ar = Self.rate(arTimes)
            let tx = (sentTimes.last.map { t - $0 < 1.0 } ?? false) ? Self.rate(sentTimes) : 0
            let track = Self.describe(frame.camera.trackingState)
            let plane = PacketEncoder.largestHorizontalPlane(frame.anchors)
            let planeText = plane.map { p in
                String(format: "%.2f x %.2f m, %.2f m below camera", p.extent.x, p.extent.y,
                       frame.camera.transform.columns.3.y - p.pose.columns.3.y)
            } ?? "not found yet"
            let s = sentCount, d = droppedCount
            DispatchQueue.main.async {
                self.arFPS = ar
                self.sentFPS = tx
                self.sent = s
                self.dropped = d
                self.tracking = track
                self.planeText = planeText
            }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.connection = "AR session failed: \(error.localizedDescription)" }
    }

    private static func rate(_ times: [TimeInterval]) -> Double {
        guard times.count >= 2, let a = times.first, let b = times.last, b > a else { return 0 }
        return Double(times.count - 1) / (b - a)
    }

    private static func describe(_ s: ARCamera.TrackingState) -> String {
        switch s {
        case .normal: return "normal"
        case .notAvailable: return "not available"
        case .limited(let r):
            switch r {
            case .initializing: return "limited (starting)"
            case .excessiveMotion: return "limited (moving fast)"
            case .insufficientFeatures: return "limited (few features)"
            case .relocalizing: return "limited (relocalizing)"
            @unknown default: return "limited"
            }
        }
    }
}
