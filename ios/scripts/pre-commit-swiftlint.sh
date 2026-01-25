#!/bin/bash
#
# Pre-commit hook for SwiftLint
# Runs SwiftLint on staged Swift files before committing

# Get the list of staged Swift files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep "\.swift$")

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

# Check if SwiftLint is installed
if ! which swiftlint > /dev/null; then
    echo "warning: SwiftLint not installed. Download from https://github.com/realm/SwiftLint"
    exit 0
fi

# Change to the ios directory
cd "$(git rev-parse --show-toplevel)/ios" || exit 1

# Run SwiftLint on staged files
echo "Running SwiftLint on staged files..."

FAILED=0
for FILE in $STAGED_FILES; do
    # Only lint files that are in the ios directory
    if [[ "$FILE" == ios/* ]]; then
        RELATIVE_FILE="${FILE#ios/}"
        if [ -f "$RELATIVE_FILE" ]; then
            swiftlint lint --path "$RELATIVE_FILE" --quiet
            if [ $? -ne 0 ]; then
                FAILED=1
            fi
        fi
    fi
done

if [ $FAILED -ne 0 ]; then
    echo "SwiftLint found issues. Please fix them before committing."
    exit 1
fi

echo "SwiftLint passed!"
exit 0
