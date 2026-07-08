import XCTest
import WebKit
@testable import AdjutantUI

/// Tests for the session-owned, REUSABLE avatar surface (adj-207.1.3 / T003).
///
/// The load-bearing invariant: the underlying web engine (a `WKWebView` in
/// Phase A) is created ONCE and reused across hide/show — navigating other
/// screens must never reload the page or reconnect the Runway/LiveKit session.
/// `BridgeWebSurface` is the concrete `BridgeSurface`; the WebKit dependency is
/// behind the `AvatarWebEngine` seam so the reuse contract is unit-testable
/// without a real webview or network.
@MainActor
final class AvatarSurfaceReuseTests: XCTestCase {

    // MARK: - Test doubles

    /// Spy engine that records every lifecycle call so tests can assert the
    /// create-once / load-once / no-reload contract.
    private final class SpyAvatarWebEngine: AvatarWebEngine {
        private(set) var loadedURLs: [URL] = []
        private(set) var setHiddenLog: [Bool] = []
        private(set) var teardownCount = 0
        var isHidden: Bool { setHiddenLog.last ?? true }

        func load(_ url: URL) { loadedURLs.append(url) }
        func setHidden(_ hidden: Bool) { setHiddenLog.append(hidden) }
        func teardown() { teardownCount += 1 }
    }

    /// Counts how many engines the surface asks the factory to build — the
    /// single most important number for "created once".
    @MainActor
    private final class SpyEngineFactory {
        private(set) var madeEngines: [SpyAvatarWebEngine] = []
        var makeCount: Int { madeEngines.count }
        func make() -> AvatarWebEngine {
            let engine = SpyAvatarWebEngine()
            madeEngines.append(engine)
            return engine
        }
    }

    private let url = URL(string: "http://localhost:4201/avatar")!

    private func makeSurface() -> (BridgeWebSurface, SpyEngineFactory) {
        let factory = SpyEngineFactory()
        let surface = BridgeWebSurface(url: url, engineFactory: { factory.make() })
        return (surface, factory)
    }

    // MARK: - Create once

    func testPrepareCreatesEngineOnceAndLoadsURLOnce() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        XCTAssertEqual(factory.makeCount, 1)
        XCTAssertEqual(factory.madeEngines.first?.loadedURLs, [url])
    }

    func testPrepareTwiceDoesNotRecreateOrReload() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        surface.prepare()
        surface.prepare()
        XCTAssertEqual(factory.makeCount, 1, "engine must be created exactly once")
        XCTAssertEqual(factory.madeEngines.first?.loadedURLs.count, 1, "must NOT reload")
    }

    // MARK: - Show/hide reuse (no reload, no reconnect)

    func testShowHideDoNotRecreateOrReload() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        surface.show()
        surface.hide()
        surface.show()
        XCTAssertEqual(factory.makeCount, 1, "no new engine across show/hide")
        XCTAssertEqual(factory.madeEngines.first?.loadedURLs.count, 1, "no reconnect across show/hide")
    }

    func testShowRevealsAndHideConceals() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        surface.show()
        XCTAssertFalse(factory.madeEngines[0].isHidden)
        XCTAssertFalse(surface.isHidden)
        surface.hide()
        XCTAssertTrue(factory.madeEngines[0].isHidden)
        XCTAssertTrue(surface.isHidden)
    }

    func testEngineInstanceIsStableAcrossShowHide() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        let first = surface.engine as AnyObject
        surface.hide()
        surface.show()
        let afterCycle = surface.engine as AnyObject
        XCTAssertTrue(first === afterCycle, "same engine instance must be reused")
    }

    // MARK: - Teardown & re-prepare

    func testTeardownReleasesEngine() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        surface.teardown()
        XCTAssertNil(surface.engine)
        XCTAssertEqual(factory.madeEngines[0].teardownCount, 1)
    }

    func testTeardownIsIdempotent() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        surface.teardown()
        surface.teardown()
        XCTAssertEqual(factory.madeEngines[0].teardownCount, 1, "engine torn down exactly once")
    }

    func testPrepareAfterTeardownCreatesAFreshEngine() {
        let (surface, factory) = makeSurface()
        surface.prepare()
        surface.teardown()
        surface.prepare()
        XCTAssertEqual(factory.makeCount, 2, "re-prepare after teardown builds a new engine")
        XCTAssertEqual(factory.madeEngines[1].loadedURLs, [url])
    }

    // MARK: - Idempotent visibility before prepare

    func testShowBeforePrepareIsSafeNoOp() {
        let (surface, factory) = makeSurface()
        surface.show()
        XCTAssertEqual(factory.makeCount, 0, "show without a prepared engine does nothing")
    }

    // MARK: - Drives BridgeSession as its surface

    func testSurfaceReusedAcrossAFullSessionCycle() {
        let (surface, factory) = makeSurface()
        let session = BridgeSession(surface: surface)
        session.open()          // → prepare (engine created)
        session.markConnected() // → show
        // Simulate navigation churn: repeated hide/show must not reconnect.
        surface.hide(); surface.show(); surface.hide(); surface.show()
        XCTAssertEqual(factory.makeCount, 1, "ONE engine for the whole live session")
        XCTAssertEqual(factory.madeEngines[0].loadedURLs.count, 1, "loaded/connected once")
        session.close()         // → teardown
        XCTAssertEqual(factory.madeEngines[0].teardownCount, 1)
        XCTAssertNil(surface.engine)
    }

    // MARK: - Default production factory builds a real WKWebView engine

    func testDefaultSurfaceBuildsAWebKitEngine() {
        let surface = BridgeWebSurface.makeDefault(url: url)
        surface.prepare()
        XCTAssertNotNil(surface.engine)
        XCTAssertTrue(surface.engine is WKAvatarWebEngine)
        // The concrete engine must expose a hostable UIView for embedding.
        XCTAssertNotNil((surface.engine as? WKAvatarWebEngine)?.hostView)
        surface.teardown()
    }
}
