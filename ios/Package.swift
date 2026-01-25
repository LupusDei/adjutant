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
            name: "Adjutant",
            targets: ["Adjutant"]
        )
    ],
    dependencies: [
        .package(path: "AdjutantKit")
    ],
    targets: [
        .target(
            name: "Adjutant",
            dependencies: ["AdjutantKit"],
            path: "Adjutant"
        ),
        .testTarget(
            name: "AdjutantTests",
            dependencies: ["Adjutant", "AdjutantKit"],
            path: "AdjutantTests"
        )
    ]
)
