import Foundation
import Combine

/// Protocol defining the base interface for all ViewModels in the MVVM architecture.
/// ViewModels conforming to this protocol are observable and provide common functionality
/// for loading states, error handling, and lifecycle management.
@MainActor
protocol ViewModelProtocol: ObservableObject {
    /// Indicates whether the ViewModel is currently loading data
    var isLoading: Bool { get }

    /// The current error message, if any
    var errorMessage: String? { get }

    /// Called when the view appears
    func onAppear()

    /// Called when the view disappears
    func onDisappear()

    /// Refreshes the ViewModel's data
    func refresh() async
}

/// Default implementations for ViewModelProtocol
extension ViewModelProtocol {
    func onAppear() {
        // Default: no-op
    }

    func onDisappear() {
        // Default: no-op
    }
}
