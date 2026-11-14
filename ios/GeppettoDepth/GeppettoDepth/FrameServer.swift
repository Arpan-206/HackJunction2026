import Foundation
import Network

/// TCP listener on a fixed port (Network.framework). One client at a time; a new client
/// replaces the old one. At most one packet in flight: the caller skips frames while busy.
/// Over USB, iproxy on the Mac reaches this listener through usbmuxd.
final class FrameServer {
    let port: UInt16
    /// (text for the screen, whether a Mac is connected)
    var onState: ((String, Bool) -> Void)?

    private let queue = DispatchQueue(label: "geppetto.depth.server")
    private let lock = NSLock()
    // queue only
    private var listener: NWListener?
    private var connection: NWConnection?
    // lock protected
    private var ready = false
    private var inFlight = false

    init(port: UInt16) {
        self.port = port
    }

    var hasClient: Bool {
        lock.lock(); defer { lock.unlock() }
        return ready
    }

    var isIdle: Bool {
        lock.lock(); defer { lock.unlock() }
        return ready && !inFlight
    }

    func ensureListening() {
        queue.async {
            if self.listener == nil { self.startListener() }
        }
    }

    /// Queue one packet. Returns false (and sends nothing) if no Mac is connected or a packet is in flight.
    func send(_ data: Data) -> Bool {
        lock.lock()
        guard ready, !inFlight else { lock.unlock(); return false }
        inFlight = true
        lock.unlock()
        queue.async {
            guard let c = self.connection else { self.setFlags(inFlight: false); return }
            c.send(content: data, completion: .contentProcessed { [weak self] error in
                self?.setFlags(inFlight: false)
                if error != nil { c.cancel() }
            })
        }
        return true
    }

    // MARK: private, on queue

    private func startListener() {
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            if let tcp = params.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options {
                tcp.noDelay = true
            }
            let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
            l.newConnectionHandler = { [weak self] c in self?.accept(c) }
            l.stateUpdateHandler = { [weak self, weak l] state in
                guard let self else { return }
                switch state {
                case .ready:
                    if self.connection == nil { self.report("waiting for the Mac on port \(self.port)", false) }
                case .failed(let error):
                    self.report("listener failed: \(error); retrying", false)
                    l?.cancel()
                    self.listener = nil
                    self.queue.asyncAfter(deadline: .now() + 1) { if self.listener == nil { self.startListener() } }
                case .cancelled:
                    if self.listener === l { self.listener = nil }
                default:
                    break
                }
            }
            listener = l
            l.start(queue: queue)
        } catch {
            report("cannot listen on port \(port): \(error); retrying", false)
            queue.asyncAfter(deadline: .now() + 1) { if self.listener == nil { self.startListener() } }
        }
    }

    private func accept(_ c: NWConnection) {
        connection?.cancel()
        connection = c
        setFlags(ready: false, inFlight: false)
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c, self.connection === c else { return }
            switch state {
            case .ready:
                self.setFlags(ready: true)
                self.report("Mac connected", true)
            case .failed, .cancelled:
                self.connection = nil
                self.setFlags(ready: false, inFlight: false)
                self.report("waiting for the Mac on port \(self.port)", false)
            default:
                break
            }
        }
        c.start(queue: queue)
        receive(on: c)
    }

    /// The Mac sends nothing; reading only notices when it closes.
    private func receive(on c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self, weak c] _, _, isComplete, error in
            guard let c else { return }
            if isComplete || error != nil {
                c.cancel()
                return
            }
            self?.receive(on: c)
        }
    }

    private func setFlags(ready r: Bool? = nil, inFlight f: Bool? = nil) {
        lock.lock()
        if let r { ready = r }
        if let f { inFlight = f }
        lock.unlock()
    }

    private func report(_ text: String, _ connected: Bool) {
        onState?(text, connected)
    }
}
