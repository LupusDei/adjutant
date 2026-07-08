import XCTest
@testable import AdjutantUI

/// Tests for the app-root Bridge host (adj-207.1.2 / T002).
///
/// `BridgeHost` is the app-root owner of the single session + reusable surface.
/// Because it lives ABOVE the SwiftUI navigation/tab bar (mounted by
/// `BridgeHostContainer`), the surface it holds survives navigation: moving
/// between screens NEVER unmounts or recreates the avatar. These tests pin:
///   1. Mount state is a pure function of session lifecycle (open mounts, close
///      unmounts) — never affected by content navigation.
///   2. The surface/engine is created ONCE and stays stable while live, across
///      simulated navigation churn (no reload/reconnect).
///   3. open/close/show/hide all route through the owned session.
@MainActor
final class BridgeHostContainerTests: XCTestCase {

    /// Spy engine recording creates/loads/teardowns so we can prove the surface
    /// is not rebuilt across navigation.
    private final class SpyAvatarWebEngine: AvatarWebEngine {
        private(set) var loadCount = 0
        private(set) var teardownCount = 0
        var hidden = true
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?
        func load(_ url: URL) { loadCount += 1 }
        func setHidden(_ hidden: Bool) { self.hidden = hidden }
        func setMicEnabled(_ enabled: Bool) {}
        func teardown() { teardownCount += 1 }
    }

    @MainActor
    private final class SpyEngineFactory {
        private(set) var engines: [SpyAvatarWebEngine] = []
        var makeCount: Int { engines.count }
        func make() -> AvatarWebEngine {
            let e = SpyAvatarWebEngine()
            engines.append(e)
            return e
        }
    }

    private let url = URL(string: "http://localhost:4201/avatar")!

    private func makeHost() -> (BridgeHost, SpyEngineFactory) {
        let factory = SpyEngineFactory()
        let surface = BridgeWebSurface(url: url, engineFactory: { factory.make() })
        // No connect watchdog in these unit tests (avoid real timers); the
        // timeout path is covered in BridgeSessionTests via a manual double.
        return (BridgeHost(webSurface: surface, connectTimeout: nil), factory)
    }

    // MARK: - Mount state follows lifecycle

    func testSurfaceNotMountedBeforeOpen() {
        let (host, factory) = makeHost()
        XCTAssertFalse(host.isSurfaceMounted)
        XCTAssertEqual(factory.makeCount, 0)
    }

    func testOpenMountsSurfaceAndCreatesEngineOnce() {
        let (host, factory) = makeHost()
        host.open()
        XCTAssertTrue(host.isSurfaceMounted)
        XCTAssertEqual(host.session.state, .connecting)
        XCTAssertEqual(factory.makeCount, 1)
        XCTAssertEqual(factory.engines.first?.loadCount, 1)
    }

    func testCloseUnmountsSurfaceAndTearsDownOnce() {
        let (host, factory) = makeHost()
        host.open()
        host.session.markConnected()
        host.close()
        XCTAssertFalse(host.isSurfaceMounted)
        XCTAssertEqual(host.session.state, .closed)
        XCTAssertEqual(factory.engines.first?.teardownCount, 1)
    }

    // MARK: - Phase B: no eager native-PiP construction (adj-207.5 regression)

    /// The designated init (and thus every unit test + the app until PiP is first
    /// used) must NOT build the native PiP surface — building it eagerly spins up a
    /// real LiveKit `Room()` + `AVPictureInPictureController` at launch, which stalled
    /// the test host on headless CI. The surface is lazy; here it is never created.
    func testDesignatedInitBuildsNoNativePiPSurface() {
        let (host, _) = makeHost()
        XCTAssertNil(host.pipSurface, "no PiP surface (no LiveKit room) built at construction")
        XCTAssertNil(host.pipCoordinator)
        XCTAssertFalse(host.isPiPAvailable, "no base URL → PiP unavailable, nothing eager built")
    }

    // MARK: - Survives navigation (the whole point)

    func testSurfaceSurvivesSimulatedNavigationWithoutReloadOrUnmount() {
        let (host, factory) = makeHost()
        host.open()
        host.session.markConnected()
        // Simulate the Commander navigating across several in-app screens while
        // the Bridge is live. The host lives above navigation, so the surface is
        // untouched — no new engine, no re-load, no unmount.
        for _ in 0..<5 {
            host.notePresentedContentChanged()
        }
        XCTAssertTrue(host.isSurfaceMounted, "surface stays mounted across navigation")
        XCTAssertEqual(factory.makeCount, 1, "engine NEVER recreated on navigation")
        XCTAssertEqual(factory.engines.first?.loadCount, 1, "page NEVER reloaded/reconnected")
        XCTAssertEqual(factory.engines.first?.teardownCount, 0)
    }

    // MARK: - Single-instance guard through the host

    func testOpeningWhileMountedIsSingleInstance() {
        let (host, factory) = makeHost()
        host.open()
        host.session.markConnected()
        host.open() // second open while live
        XCTAssertEqual(factory.makeCount, 1, "no second surface")
        XCTAssertEqual(host.session.focusRequestCount, 1)
    }

    // MARK: - Intents route through the session

    func testShowHideRouteThroughSessionWithoutRecreate() {
        let (host, factory) = makeHost()
        host.open()
        host.session.markConnected()
        host.hide()
        XCTAssertTrue(factory.engines[0].hidden)
        host.show()
        XCTAssertFalse(factory.engines[0].hidden)
        XCTAssertEqual(factory.makeCount, 1, "show/hide never rebuild the surface")
        XCTAssertEqual(factory.engines[0].loadCount, 1)
    }

    func testHostExposesTheOwnedSessionAndSurface() {
        let (host, _) = makeHost()
        XCTAssertFalse(host.session.isActive)
        // The host's surface is the same object the session drives.
        host.open()
        XCTAssertNotNil(host.webSurface.engine)
    }
}
