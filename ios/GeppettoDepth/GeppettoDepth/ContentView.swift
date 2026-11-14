import SwiftUI

/// Depth preview (blue near, red far, dim where confidence is low), frame rates and connection state.
struct ContentView: View {
    @ObservedObject var streamer: DepthStreamer

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let img = streamer.preview {
                Image(uiImage: img)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Text(streamer.unsupported ? "This device has no LiDAR scene depth." : "Starting the camera...")
                    .font(.system(size: 22))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Geppetto Depth").font(.system(size: 22, weight: .bold))
                Text(streamer.connection)
                    .foregroundColor(streamer.clientConnected ? .green : .orange)
                Text(String(format: "camera %.0f fps   sent %.0f fps", streamer.arFPS, streamer.sentFPS))
                Text("sent \(streamer.sent)   skipped \(streamer.dropped)")
                Text("tracking \(streamer.tracking)")
                Text("table \(streamer.planeText)")
                Text("phone port \(String(DepthProtocol.port))   wifi \(FrameServer.wifiAddress() ?? "off")   usb via forward.sh")
                Text(String(format: "depth colours %.1f m blue to %.1f m red", DepthPreview.near, DepthPreview.far))
            }
            .font(.system(size: 17, design: .monospaced))
            .foregroundColor(.white)
            .padding(12)
            .background(Color.black.opacity(0.6))
            .cornerRadius(8)
            .padding()
        }
        .statusBarHidden(true)
    }
}
