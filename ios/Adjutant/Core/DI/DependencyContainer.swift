import Foundation

/// Lightweight dependency injection container for managing service instances.
/// Supports both singleton and factory registrations for flexible lifecycle management.
@MainActor
final class DependencyContainer {
    // MARK: - Singleton

    static let shared = DependencyContainer()

    // MARK: - Storage

    private var singletons: [ObjectIdentifier: Any] = [:]
    private var factories: [ObjectIdentifier: () -> Any] = [:]

    // MARK: - Initialization

    private init() {}

    // MARK: - Registration

    /// Registers a singleton instance that will be reused for all resolutions.
    /// - Parameters:
    ///   - type: The type to register
    ///   - instance: The singleton instance
    func registerSingleton<T>(_ type: T.Type, instance: T) {
        let key = ObjectIdentifier(type)
        singletons[key] = instance
    }

    /// Registers a factory closure that creates a new instance for each resolution.
    /// - Parameters:
    ///   - type: The type to register
    ///   - factory: The factory closure that creates instances
    func registerFactory<T>(_ type: T.Type, factory: @escaping () -> T) {
        let key = ObjectIdentifier(type)
        factories[key] = factory
    }

    /// Registers a lazy singleton that is created on first resolution.
    /// - Parameters:
    ///   - type: The type to register
    ///   - factory: The factory closure that creates the singleton
    func registerLazySingleton<T>(_ type: T.Type, factory: @escaping () -> T) {
        let key = ObjectIdentifier(type)
        factories[key] = { [weak self] in
            if let existing = self?.singletons[key] as? T {
                return existing
            }
            let instance = factory()
            self?.singletons[key] = instance
            return instance
        }
    }

    // MARK: - Resolution

    /// Resolves a registered dependency.
    /// - Parameter type: The type to resolve
    /// - Returns: The resolved instance
    /// - Throws: `DependencyError.notRegistered` if the type is not registered
    func resolve<T>(_ type: T.Type) throws -> T {
        let key = ObjectIdentifier(type)

        // Check singletons first
        if let singleton = singletons[key] as? T {
            return singleton
        }

        // Try factory
        if let factory = factories[key], let instance = factory() as? T {
            return instance
        }

        throw DependencyError.notRegistered(String(describing: type))
    }

    /// Resolves a registered dependency, returning nil if not found.
    /// - Parameter type: The type to resolve
    /// - Returns: The resolved instance or nil
    func resolveOptional<T>(_ type: T.Type) -> T? {
        try? resolve(type)
    }

    // MARK: - Utilities

    /// Removes all registered dependencies. Useful for testing.
    func reset() {
        singletons.removeAll()
        factories.removeAll()
    }

    /// Checks if a type is registered.
    /// - Parameter type: The type to check
    /// - Returns: True if the type is registered
    func isRegistered<T>(_ type: T.Type) -> Bool {
        let key = ObjectIdentifier(type)
        return singletons[key] != nil || factories[key] != nil
    }
}

// MARK: - Errors

enum DependencyError: LocalizedError {
    case notRegistered(String)

    var errorDescription: String? {
        switch self {
        case .notRegistered(let type):
            return "Dependency not registered: \(type)"
        }
    }
}

// MARK: - Property Wrapper

/// Property wrapper for automatic dependency injection.
/// Usage: `@Injected var service: MyServiceProtocol`
/// Note: This property wrapper requires MainActor context as it accesses the shared container.
@MainActor
@propertyWrapper
struct Injected<T> {
    private var value: T?

    var wrappedValue: T {
        mutating get {
            if let value = value {
                return value
            }
            guard let resolved = DependencyContainer.shared.resolveOptional(T.self) else {
                fatalError("Dependency not registered: \(T.self)")
            }
            value = resolved
            return resolved
        }
    }

    init() {}
}
