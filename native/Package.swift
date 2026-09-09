// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "zrv-native",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "zrv-native", targets: ["zrv-native"]),
    ],
    targets: [
        .executableTarget(
            name: "zrv-native",
            path: "Sources/zrv-native"
        ),
    ]
)
