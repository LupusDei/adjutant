import Foundation
import Combine
import AdjutantKit

/// Base ViewModel class providing common functionality for all ViewModels.
/// Subclass this to create feature-specific ViewModels with built-in
/// loading state, error handling, and cancellation support.
@MainActor
class BaseViewModel: ObservableObject, ViewModelProtocol {
    // MARK: - Published Properties

    /// Indicates whether the ViewModel is currently loading data
    @Published private(set) var isLoading = false

    /// The current error message, if any
    @Published var errorMessage: String?

    // MARK: - Internal Properties

    /// Set to store Combine cancellables for proper cleanup
    var cancellables = Set<AnyCancellable>()

    /// Task for managing async operations that should be cancelled on disappear
    private var activeTask: Task<Void, Never>?

    // MARK: - Initialization

    init() {}

    deinit {
        activeTask?.cancel()
        cancellables.removeAll()
    }

    // MARK: - Lifecycle

    func onAppear() {
        Task {
            await refresh()
        }
    }

    func onDisappear() {
        activeTask?.cancel()
        activeTask = nil
    }

    // MARK: - Data Loading

    func refresh() async {
        // Override in subclasses to implement refresh logic
    }

    // MARK: - Helper Methods

    /// Executes an async operation with automatic loading state management and error handling.
    /// - Parameters:
    ///   - showLoading: Whether to show the loading indicator (default: true)
    ///   - operation: The async operation to execute
    func performAsync<T>(
        showLoading: Bool = true,
        _ operation: @escaping () async throws -> T
    ) async -> T? {
        if showLoading {
            isLoading = true
        }
        errorMessage = nil

        do {
            let result = try await operation()
            if showLoading {
                isLoading = false
            }
            return result
        } catch is CancellationError {
            // Task was cancelled, don't update state
            return nil
        } catch {
            if showLoading {
                isLoading = false
            }
            handleError(error)
            return nil
        }
    }

    /// Executes an async operation that doesn't return a value.
    /// - Parameters:
    ///   - showLoading: Whether to show the loading indicator (default: true)
    ///   - operation: The async operation to execute
    func performAsyncAction(
        showLoading: Bool = true,
        _ operation: @escaping () async throws -> Void
    ) async {
        _ = await performAsync(showLoading: showLoading) {
            try await operation()
            return ()
        }
    }

    /// Starts a tracked async task that will be cancelled when the view disappears.
    /// - Parameter operation: The async operation to execute
    func startTrackedTask(_ operation: @escaping () async -> Void) {
        activeTask?.cancel()
        activeTask = Task {
            await operation()
        }
    }

    /// Handles an error by setting the error message.
    /// Override this method to provide custom error handling.
    /// - Parameter error: The error to handle
    func handleError(_ error: Error) {
        // Suppress cancellation errors — these are expected during rapid
        // view lifecycle transitions (e.g., refresh cancelled by a newer refresh)
        if error is CancellationError { return }
        if let apiError = error as? APIClientError, apiError == .cancelled { return }

        if let serviceError = error as? ServiceError {
            errorMessage = serviceError.errorDescription
        } else {
            errorMessage = error.localizedDescription
        }
    }

    /// Clears the current error message.
    func clearError() {
        errorMessage = nil
    }
}
