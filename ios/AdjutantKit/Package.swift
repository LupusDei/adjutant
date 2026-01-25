// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "AdjutantKit",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "AdjutantKit",
            targets: ["AdjutantKit"]
        )
    ],
    targets: [
        .target(
            name: "AdjutantKit",
            path: "Sources/AdjutantKit"
        ),
        .testTarget(
            name: "AdjutantKitTests",
            dependencies: ["AdjutantKit"],
            path: "Tests/AdjutantKitTests"
        )
    ]
)
