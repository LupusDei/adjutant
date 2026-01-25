import XCTest
@testable import Adjutant

@MainActor
final class DependencyContainerTests: XCTestCase {
    var container: DependencyContainer!

    override func setUp() async throws {
        container = DependencyContainer.shared
        container.reset()
    }

    override func tearDown() async throws {
        container.reset()
        container = nil
    }

    // MARK: - Singleton Registration Tests

    func testRegisterSingleton() throws {
        let service = MockService()
        container.registerSingleton(MockServiceProtocol.self, instance: service)

        let resolved = try container.resolve(MockServiceProtocol.self)

        XCTAssertTrue(resolved === service)
    }

    func testSingletonReturnsSameInstance() throws {
        let service = MockService()
        container.registerSingleton(MockServiceProtocol.self, instance: service)

        let resolved1 = try container.resolve(MockServiceProtocol.self)
        let resolved2 = try container.resolve(MockServiceProtocol.self)

        XCTAssertTrue(resolved1 === resolved2)
    }

    // MARK: - Factory Registration Tests

    func testRegisterFactory() throws {
        var callCount = 0
        container.registerFactory(MockServiceProtocol.self) {
            callCount += 1
            return MockService()
        }

        let resolved1 = try container.resolve(MockServiceProtocol.self)
        let resolved2 = try container.resolve(MockServiceProtocol.self)

        XCTAssertFalse(resolved1 === resolved2)
        XCTAssertEqual(callCount, 2)
    }

    func testFactoryCreatesNewInstanceEachTime() throws {
        container.registerFactory(MockServiceProtocol.self) {
            MockService()
        }

        let resolved1 = try container.resolve(MockServiceProtocol.self)
        let resolved2 = try container.resolve(MockServiceProtocol.self)

        XCTAssertFalse(resolved1 === resolved2)
    }

    // MARK: - Lazy Singleton Tests

    func testRegisterLazySingleton() throws {
        var created = false
        container.registerLazySingleton(MockServiceProtocol.self) {
            created = true
            return MockService()
        }

        XCTAssertFalse(created, "Should not create until first resolution")

        _ = try container.resolve(MockServiceProtocol.self)

        XCTAssertTrue(created, "Should create on first resolution")
    }

    func testLazySingletonReturnsSameInstance() throws {
        container.registerLazySingleton(MockServiceProtocol.self) {
            MockService()
        }

        let resolved1 = try container.resolve(MockServiceProtocol.self)
        let resolved2 = try container.resolve(MockServiceProtocol.self)

        XCTAssertTrue(resolved1 === resolved2)
    }

    // MARK: - Resolution Tests

    func testResolveUnregisteredThrows() {
        XCTAssertThrowsError(try container.resolve(UnregisteredService.self)) { error in
            guard case DependencyError.notRegistered(let type) = error else {
                XCTFail("Expected DependencyError.notRegistered")
                return
            }
            XCTAssertEqual(type, "UnregisteredService")
        }
    }

    func testResolveOptionalReturnsNilForUnregistered() {
        let result = container.resolveOptional(UnregisteredService.self)

        XCTAssertNil(result)
    }

    func testResolveOptionalReturnsInstanceForRegistered() {
        container.registerSingleton(MockServiceProtocol.self, instance: MockService())

        let result = container.resolveOptional(MockServiceProtocol.self)

        XCTAssertNotNil(result)
    }

    // MARK: - Utility Tests

    func testIsRegistered() {
        XCTAssertFalse(container.isRegistered(MockServiceProtocol.self))

        container.registerSingleton(MockServiceProtocol.self, instance: MockService())

        XCTAssertTrue(container.isRegistered(MockServiceProtocol.self))
    }

    func testReset() throws {
        container.registerSingleton(MockServiceProtocol.self, instance: MockService())

        XCTAssertTrue(container.isRegistered(MockServiceProtocol.self))

        container.reset()

        XCTAssertFalse(container.isRegistered(MockServiceProtocol.self))
    }
}

// MARK: - Test Helpers

private protocol MockServiceProtocol: AnyObject {}

private class MockService: MockServiceProtocol {}

private class UnregisteredService {}
