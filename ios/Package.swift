// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "Adjutant",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "AdjutantUI",
            targets: ["AdjutantUI"]
        )
    ],
    dependencies: [
        .package(path: "AdjutantKit"),
        // LiveKit Swift SDK (adj-207.4.1) — the native Phase-B avatar client subscribes
        // (read-only) to the SAME Runway avatar room to obtain the video track for system
        // PiP (AVSampleBufferDisplayLayer + AVPictureInPictureController). Second SUBSCRIBER
        // to the ONE session, never a second session.
        .package(url: "https://github.com/livekit/client-sdk-swift.git", from: "2.9.0")
    ],
    targets: [
        .target(
            name: "AdjutantUI",
            dependencies: [
                "AdjutantKit",
                .product(name: "LiveKit", package: "client-sdk-swift")
            ],
            path: "Adjutant",
            exclude: ["App/AdjutantApp.swift", "App/AppDelegate.swift"]
        ),
        .testTarget(
            name: "AdjutantTests",
            dependencies: ["AdjutantUI", "AdjutantKit"],
            path: "AdjutantTests"
        )
    ]
)
