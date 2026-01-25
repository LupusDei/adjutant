import XCTest
import Combine
@testable import Adjutant
@testable import AdjutantKit

@MainActor
final class MailListViewModelTests: XCTestCase {
    private var viewModel: MailListViewModel!
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        viewModel = MailListViewModel()
        cancellables = Set<AnyCancellable>()
    }

    override func tearDown() async throws {
        viewModel = nil
        cancellables = nil
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertTrue(viewModel.messages.isEmpty)
        XCTAssertTrue(viewModel.filteredMessages.isEmpty)
        XCTAssertEqual(viewModel.currentFilter, .all)
        XCTAssertTrue(viewModel.searchText.isEmpty)
        XCTAssertFalse(viewModel.isSearching)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }

    // MARK: - Loading Tests

    func testLoadMessagesPopulatesMessageList() async {
        await viewModel.loadMessages()

        XCTAssertFalse(viewModel.messages.isEmpty)
        XCTAssertEqual(viewModel.messages.count, MailListViewModel.mockMessages.count)
        XCTAssertEqual(viewModel.filteredMessages.count, viewModel.messages.count)
    }

    func testRefreshCallsLoadMessages() async {
        await viewModel.refresh()

        XCTAssertFalse(viewModel.messages.isEmpty)
    }

    // MARK: - Filter Tests

    func testFilterAll() async {
        await viewModel.loadMessages()
        viewModel.currentFilter = .all

        XCTAssertEqual(viewModel.filteredMessages.count, viewModel.messages.count)
    }

    func testFilterUnread() async {
        await viewModel.loadMessages()
        viewModel.currentFilter = .unread

        let expectedUnread = viewModel.messages.filter { !$0.read }
        XCTAssertEqual(viewModel.filteredMessages.count, expectedUnread.count)
        XCTAssertTrue(viewModel.filteredMessages.allSatisfy { !$0.read })
    }

    func testFilterPriority() async {
        await viewModel.loadMessages()
        viewModel.currentFilter = .priority

        let expectedPriority = viewModel.messages.filter {
            $0.priority.rawValue <= MessagePriority.high.rawValue
        }
        XCTAssertEqual(viewModel.filteredMessages.count, expectedPriority.count)
        XCTAssertTrue(viewModel.filteredMessages.allSatisfy {
            $0.priority.rawValue <= MessagePriority.high.rawValue
        })
    }

    // MARK: - Search Tests

    func testSearchBySubject() async {
        await viewModel.loadMessages()
        viewModel.searchText = "initialization"

        XCTAssertFalse(viewModel.filteredMessages.isEmpty)
        XCTAssertTrue(viewModel.filteredMessages.allSatisfy {
            $0.subject.lowercased().contains("initialization")
        })
    }

    func testSearchByFrom() async {
        await viewModel.loadMessages()
        viewModel.searchText = "mayor"

        XCTAssertFalse(viewModel.filteredMessages.isEmpty)
        XCTAssertTrue(viewModel.filteredMessages.allSatisfy {
            $0.from.lowercased().contains("mayor")
        })
    }

    func testSearchByBody() async {
        await viewModel.loadMessages()
        viewModel.searchText = "merged"

        XCTAssertFalse(viewModel.filteredMessages.isEmpty)
    }

    func testSearchWithNoResults() async {
        await viewModel.loadMessages()
        viewModel.searchText = "xyznonexistent"

        XCTAssertTrue(viewModel.filteredMessages.isEmpty)
    }

    func testSearchCombinedWithFilter() async {
        await viewModel.loadMessages()
        viewModel.currentFilter = .unread
        viewModel.searchText = "urgent"

        // Should find unread messages containing "urgent"
        XCTAssertTrue(viewModel.filteredMessages.allSatisfy { !$0.read })
    }

    func testClearSearchRestoresFilteredList() async {
        await viewModel.loadMessages()
        let initialCount = viewModel.filteredMessages.count

        viewModel.searchText = "xyz"
        XCTAssertTrue(viewModel.filteredMessages.isEmpty)

        viewModel.searchText = ""
        XCTAssertEqual(viewModel.filteredMessages.count, initialCount)
    }

    // MARK: - Mark Read/Unread Tests

    func testMarkAsRead() async {
        await viewModel.loadMessages()
        guard let unreadMessage = viewModel.messages.first(where: { !$0.read }) else {
            XCTFail("No unread message found")
            return
        }

        await viewModel.markAsRead(unreadMessage)

        let updatedMessage = viewModel.messages.first(where: { $0.id == unreadMessage.id })
        XCTAssertTrue(updatedMessage?.read ?? false)
    }

    func testMarkAsUnread() async {
        await viewModel.loadMessages()
        guard let readMessage = viewModel.messages.first(where: { $0.read }) else {
            XCTFail("No read message found")
            return
        }

        await viewModel.markAsUnread(readMessage)

        let updatedMessage = viewModel.messages.first(where: { $0.id == readMessage.id })
        XCTAssertFalse(updatedMessage?.read ?? true)
    }

    func testToggleReadStatus() async {
        await viewModel.loadMessages()
        guard let message = viewModel.messages.first else {
            XCTFail("No message found")
            return
        }
        let initialReadStatus = message.read

        await viewModel.toggleReadStatus(message)

        let updatedMessage = viewModel.messages.first(where: { $0.id == message.id })
        XCTAssertEqual(updatedMessage?.read, !initialReadStatus)
    }

    // MARK: - Delete Tests

    func testDeleteMessage() async {
        await viewModel.loadMessages()
        let initialCount = viewModel.messages.count
        guard let messageToDelete = viewModel.messages.first else {
            XCTFail("No message found")
            return
        }

        await viewModel.deleteMessage(messageToDelete)

        XCTAssertEqual(viewModel.messages.count, initialCount - 1)
        XCTAssertFalse(viewModel.messages.contains(where: { $0.id == messageToDelete.id }))
    }

    func testDeleteMessagesAtOffsets() async {
        await viewModel.loadMessages()
        let initialCount = viewModel.filteredMessages.count

        await viewModel.deleteMessages(at: IndexSet([0, 1]))

        XCTAssertEqual(viewModel.filteredMessages.count, initialCount - 2)
    }

    // MARK: - Computed Properties Tests

    func testUnreadCount() async {
        await viewModel.loadMessages()

        let expectedUnreadCount = viewModel.messages.filter { !$0.read }.count
        XCTAssertEqual(viewModel.unreadCount, expectedUnreadCount)
    }

    func testIsEmpty() async {
        XCTAssertTrue(viewModel.isEmpty)

        await viewModel.loadMessages()
        XCTAssertFalse(viewModel.isEmpty)

        // Filter to get empty result
        viewModel.searchText = "xyznonexistent"
        XCTAssertTrue(viewModel.isEmpty)
    }

    func testEmptyStateMessageForAllFilter() async {
        viewModel.currentFilter = .all
        XCTAssertEqual(viewModel.emptyStateMessage, "Your inbox is empty")
    }

    func testEmptyStateMessageForUnreadFilter() async {
        viewModel.currentFilter = .unread
        XCTAssertEqual(viewModel.emptyStateMessage, "No unread messages")
    }

    func testEmptyStateMessageForPriorityFilter() async {
        viewModel.currentFilter = .priority
        XCTAssertEqual(viewModel.emptyStateMessage, "No priority messages")
    }

    func testEmptyStateMessageForSearch() async {
        viewModel.searchText = "test"
        XCTAssertEqual(viewModel.emptyStateMessage, "No messages match your search")
    }

    // MARK: - Message Sorting Tests

    func testMessagesAreSortedByDateDescending() async {
        await viewModel.loadMessages()

        // Verify messages are sorted newest first
        var previousDate: Date?
        for message in viewModel.messages {
            if let date = message.date {
                if let prev = previousDate {
                    XCTAssertGreaterThanOrEqual(prev, date, "Messages should be sorted newest first")
                }
                previousDate = date
            }
        }
    }

    // MARK: - Rig Filter Tests

    func testRigFilterFiltersMessagesByRig() async {
        await viewModel.loadMessages()
        let initialCount = viewModel.filteredMessages.count

        // Set a rig filter that won't match any mock messages
        // (mock messages use "mayor/", "witness/", etc. which are town-level)
        AppState.shared.selectedRig = "testrig"

        // Since none of the mock messages are from "testrig/", filtered should be empty
        XCTAssertTrue(viewModel.filteredMessages.isEmpty)

        // Clear rig filter
        AppState.shared.selectedRig = nil
        XCTAssertEqual(viewModel.filteredMessages.count, initialCount)
    }

    func testRigFilterMatchesFromAddress() async {
        await viewModel.loadMessages()

        // The mock messages have addresses like "crew/onyx" - so filter by "crew"
        AppState.shared.selectedRig = "crew"

        // Should find the message from "crew/onyx"
        XCTAssertFalse(viewModel.filteredMessages.isEmpty)
        XCTAssertTrue(viewModel.filteredMessages.allSatisfy {
            $0.from.lowercased().hasPrefix("crew/") || $0.to.lowercased().hasPrefix("crew/")
        })

        // Clean up
        AppState.shared.selectedRig = nil
    }
}
