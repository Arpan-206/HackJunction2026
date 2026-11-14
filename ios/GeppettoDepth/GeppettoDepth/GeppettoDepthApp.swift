import SwiftUI
import UIKit

/// Geppetto Depth: streams iPhone LiDAR depth to the Mac over the USB cable (see ios/PROTOCOL.md).
@main
struct GeppettoDepthApp: App {
    @StateObject private var streamer = DepthStreamer()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(streamer: streamer)
                .onAppear {
                    UIApplication.shared.isIdleTimerDisabled = true   // keep the screen awake
                    streamer.start()
                }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                UIApplication.shared.isIdleTimerDisabled = true
                streamer.start()
                streamer.restartServer()
            }
        }
    }
}
