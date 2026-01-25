# Adjutant iOS App

Retro terminal UI for Gas Town multi-agent orchestration - iOS companion app.

## Requirements

- Xcode 15.2 or later
- iOS 17.0+ deployment target
- macOS Sonoma 14.0+ for development
- [SwiftLint](https://github.com/realm/SwiftLint) for code quality

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd adjutant/ios
```

### 2. Install SwiftLint

Using Homebrew:

```bash
brew install swiftlint
```

Or download from [SwiftLint releases](https://github.com/realm/SwiftLint/releases).

### 3. Open the Project

```bash
open Adjutant.xcodeproj
```

### 4. Build and Run

1. Select the **Adjutant** scheme in Xcode
2. Choose a simulator or connected device (iOS 17.0+)
3. Press **Cmd + R** to build and run

## Project Structure

```
ios/
├── Adjutant.xcodeproj/     # Xcode project file
├── Adjutant/
│   ├── App/                # App entry point and root views
│   │   ├── AdjutantApp.swift
│   │   └── ContentView.swift
│   ├── Features/           # Feature modules (Dashboard, Mail, etc.)
│   ├── Core/               # Core utilities, extensions, protocols
│   ├── Services/           # API clients, networking, data services
│   ├── Resources/          # Assets, colors, fonts
│   │   └── Assets.xcassets
│   └── Preview Content/    # SwiftUI preview assets
├── AdjutantTests/          # Unit tests
├── AdjutantUITests/        # UI tests
├── scripts/                # Build and development scripts
│   └── pre-commit-swiftlint.sh
└── .swiftlint.yml          # SwiftLint configuration
```

## Build Configurations

| Configuration | Description |
|---------------|-------------|
| **Debug**     | Development builds with debug symbols, assertions enabled |
| **Release**   | Optimized production builds with symbols stripped |

## Code Quality

### SwiftLint

SwiftLint runs automatically on each build. You can also run it manually:

```bash
cd ios
swiftlint
```

To auto-fix issues:

```bash
swiftlint --fix
```

### Git Hooks

To enable the pre-commit hook for SwiftLint:

```bash
cp ios/scripts/pre-commit-swiftlint.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Testing

### Unit Tests

```bash
xcodebuild test \
  -project Adjutant.xcodeproj \
  -scheme Adjutant \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

### UI Tests

```bash
xcodebuild test \
  -project Adjutant.xcodeproj \
  -scheme Adjutant \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -only-testing:AdjutantUITests
```

## Architecture

The app follows **MVVM + Coordinator** architecture with a clean separation of concerns.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         SwiftUI Views                           │
│  (Dashboard, Mail, Crew, Settings, Chat)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         ViewModels                               │
│  (DashboardViewModel, MailListViewModel, CrewListViewModel)     │
│  - State management via @Published                               │
│  - Business logic and data transformation                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       AdjutantKit                                │
│  (APIClient, Models, Networking)                                 │
│  - Type-safe API communication                                   │
│  - Automatic retry with exponential backoff                      │
│  - Error handling                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Adjutant Backend Server                       │
│  (Node.js server at localhost:3001)                              │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Description |
|-----------|-------------|
| **View** | SwiftUI views with CRT-themed styling. Purely presentational. |
| **ViewModel** | Observable objects that manage view state and coordinate with services. |
| **Coordinator** | Manages navigation flow between screens. |
| **AdjutantKit** | Swift Package providing networking and data models. |
| **Theme** | CRT-style visual components (phosphor glow, scan lines, retro typography). |

### Key Design Patterns

**Dependency Injection**
ViewModels accept dependencies through initializers, enabling testability:
```swift
class MailListViewModel: BaseViewModel {
    private let apiClient: APIClient?

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient
        super.init()
    }
}
```

**App State**
Global state is managed through a shared `AppState` singleton:
```swift
@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var selectedRig: String?
    @Published var availableRigs: [String] = []
}
```

**Theme System**
The CRT visual theme is propagated through SwiftUI's environment:
```swift
@Environment(\.crtTheme) private var theme

// Apply theme
Text("HELLO")
    .foregroundColor(theme.primary)
    .crtGlow(color: theme.primary, radius: 8)
```

### Feature Modules

| Module | Description |
|--------|-------------|
| **Dashboard** | System overview with status widgets |
| **Mail** | Message inbox, compose, and detail views |
| **Crew** | Agent listing with status indicators |
| **Settings** | Theme selection and app configuration |
| **Chat** | Voice interaction interface |

## AdjutantKit

The networking layer is extracted into a separate Swift Package for reusability and testability.

### Quick Start

```swift
import AdjutantKit

// Create client
let client = APIClient()

// Fetch data
let status = try await client.getStatus()
let messages = try await client.getMail()
let agents = try await client.getAgents()

// Send message
let request = SendMessageRequest(
    to: "mayor/",
    subject: "Hello",
    body: "Test message"
)
try await client.sendMail(request)
```

### Documentation

AdjutantKit includes DocC documentation. Generate it with:

```bash
cd AdjutantKit
swift package generate-documentation
```

Or browse inline in Xcode with Option+Click on any symbol.

## Contributing

1. Create a feature branch from `main`
2. Make your changes following the existing code style
3. Ensure SwiftLint passes with no warnings
4. Write or update tests as needed
5. Submit a pull request

## License

See the [LICENSE](../LICENSE) file in the root directory.
