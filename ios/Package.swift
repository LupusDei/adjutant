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
        .package(path: "AdjutantKit")
    ],
    targets: [
        .target(
            name: "AdjutantUI",
            dependencies: ["AdjutantKit"],
            path: "Adjutant",
            exclude: ["App/AdjutantApp.swift"]
        ),
        .testTarget(
            name: "AdjutantTests",
            dependencies: ["AdjutantUI", "AdjutantKit"],
            path: "AdjutantTests"
        )
    ]
)
