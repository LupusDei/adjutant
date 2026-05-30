import XCTest
@testable import AdjutantUI

/// CROSS-PLATFORM CONTRACT TEST — adj-pgwa4.
///
/// The DM conversation id must be derived byte-for-byte identically on iOS and
/// the backend. The adj-pgwa4 incident was iOS deriving the id with a SPACE
/// separator while the backend uses a NUL byte, so every backend-stamped message
/// was filtered out of the iOS DM view.
///
/// This suite consumes the SAME shared fixtures the backend contract test uses
/// (`contracts/dm-conversation-id.vectors.json` at the repo root), so iOS and
/// the backend (`backend/tests/unit/dm-conversation-id-contract.test.ts`) are
/// pinned to identical expected ids. If anyone changes the derivation on either
/// side without updating the fixtures, one of the two suites fails.
final class DmConversationIdContractTests: XCTestCase {

    private struct Vector: Decodable {
        let memberA: String
        let memberB: String
        let expected: String
        let liveAnchored: Bool?
    }
    private struct OrderCheck: Decodable {
        let memberA: String
        let memberB: String
        let expected: String
    }
    private struct NegativeGuard: Decodable {
        let memberA: String
        let memberB: String
        let spaceSeparatedWrongId: String
    }
    private struct Contract: Decodable {
        let vectors: [Vector]
        let orderIndependenceCheck: OrderCheck
        let negativeGuard: NegativeGuard
    }

    /// Resolve the repo-root shared contract file from this test's source path so
    /// iOS and backend read the exact same vectors (no copy to drift).
    private func loadContract() throws -> Contract {
        var url = URL(fileURLWithPath: #filePath)
        // .../ios/AdjutantTests/Features/Chat/DmConversationIdContractTests.swift
        // → strip filename, Chat, Features, AdjutantTests, ios → repo root.
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.appendPathComponent("contracts/dm-conversation-id.vectors.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(Contract.self, from: data)
    }

    func testMatchesEverySharedContractVector() throws {
        let contract = try loadContract()
        XCTAssertFalse(contract.vectors.isEmpty)
        for v in contract.vectors {
            let id = ChatViewModel.dmConversationId(memberA: v.memberA, memberB: v.memberB)
            XCTAssertEqual(id, v.expected, "\(v.memberA) ↔ \(v.memberB)")
        }
    }

    func testOrderIndependent() throws {
        let contract = try loadContract()
        let c = contract.orderIndependenceCheck
        XCTAssertEqual(ChatViewModel.dmConversationId(memberA: c.memberA, memberB: c.memberB), c.expected)
        XCTAssertEqual(ChatViewModel.dmConversationId(memberA: c.memberB, memberB: c.memberA), c.expected)
    }

    /// The exact adj-pgwa4 regression: a SPACE separator must NOT be used.
    func testUsesNulSeparatorNotSpace() throws {
        let contract = try loadContract()
        let g = contract.negativeGuard
        let id = ChatViewModel.dmConversationId(memberA: g.memberA, memberB: g.memberB)
        XCTAssertNotEqual(id, g.spaceSeparatedWrongId,
                          "DM id derived with a SPACE separator — adj-pgwa4 regression")
    }

    func testFormatIsDmPrefixPlus24Hex() {
        let id = ChatViewModel.dmConversationId(memberA: "user", memberB: "raynor")
        XCTAssertNotNil(id.range(of: "^dm_[0-9a-f]{24}$", options: .regularExpression),
                        "unexpected id format: \(id)")
    }
}
