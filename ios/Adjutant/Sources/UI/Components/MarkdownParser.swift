import Foundation

// MARK: - Markdown Model

/// An inline element within a markdown text block.
enum MarkdownInline: Equatable {
    case text(String)
    case bold(String)
    case italic(String)
    case boldItalic(String)
    case code(String)
    case link(text: String, url: String)
}

/// A block-level markdown element.
enum MarkdownBlock: Equatable {
    case paragraph([MarkdownInline])
    case heading(level: Int, text: [MarkdownInline])
    case codeBlock(language: String?, code: String)
    case blockquote([MarkdownBlock])
    case unorderedList([[MarkdownInline]])
    case orderedList([[MarkdownInline]])
    case horizontalRule
}

// MARK: - Parser

/// Parses raw markdown strings into a structured block model.
/// Handles headers, code blocks, blockquotes, lists, horizontal rules,
/// and inline formatting (bold, italic, code, links).
enum MarkdownParser {

    /// Parse a markdown string into blocks.
    static func parse(_ input: String) -> [MarkdownBlock] {
        let lines = input.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Empty line - skip
            if trimmed.isEmpty {
                index += 1
                continue
            }

            // Fenced code block
            if trimmed.hasPrefix("```") {
                let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                index += 1
                while index < lines.count {
                    if lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        index += 1
                        break
                    }
                    codeLines.append(lines[index])
                    index += 1
                }
                blocks.append(.codeBlock(
                    language: lang.isEmpty ? nil : lang,
                    code: codeLines.joined(separator: "\n")
                ))
                continue
            }

            // Heading
            if let match = parseHeading(trimmed) {
                blocks.append(.heading(level: match.level, text: parseInline(match.text)))
                index += 1
                continue
            }

            // Horizontal rule (must check before unordered list)
            if isHorizontalRule(trimmed) {
                blocks.append(.horizontalRule)
                index += 1
                continue
            }

            // Blockquote
            if trimmed.hasPrefix("> ") || trimmed == ">" {
                var quoteLines: [String] = []
                while index < lines.count {
                    let l = lines[index].trimmingCharacters(in: .whitespaces)
                    if l.hasPrefix("> ") {
                        quoteLines.append(String(l.dropFirst(2)))
                    } else if l == ">" {
                        quoteLines.append("")
                    } else {
                        break
                    }
                    index += 1
                }
                blocks.append(.blockquote(parse(quoteLines.joined(separator: "\n"))))
                continue
            }

            // Unordered list
            if isUnorderedListItem(trimmed) {
                var items: [[MarkdownInline]] = []
                while index < lines.count {
                    let l = lines[index].trimmingCharacters(in: .whitespaces)
                    if isUnorderedListItem(l) {
                        items.append(parseInline(stripBullet(l)))
                    } else {
                        break
                    }
                    index += 1
                }
                blocks.append(.unorderedList(items))
                continue
            }

            // Ordered list
            if isOrderedListItem(trimmed) {
                var items: [[MarkdownInline]] = []
                while index < lines.count {
                    let l = lines[index].trimmingCharacters(in: .whitespaces)
                    if isOrderedListItem(l) {
                        items.append(parseInline(stripOrderedPrefix(l)))
                    } else {
                        break
                    }
                    index += 1
                }
                blocks.append(.orderedList(items))
                continue
            }

            // Paragraph - collect consecutive non-block lines
            var paraLines: [String] = []
            while index < lines.count {
                let l = lines[index]
                let lt = l.trimmingCharacters(in: .whitespaces)
                if lt.isEmpty || lt.hasPrefix("```") || parseHeading(lt) != nil
                    || isHorizontalRule(lt) || lt.hasPrefix("> ") || lt == ">"
                    || isUnorderedListItem(lt) || isOrderedListItem(lt) {
                    break
                }
                paraLines.append(l)
                index += 1
            }
            if !paraLines.isEmpty {
                // Join with \n to preserve line breaks (GFM-style)
                blocks.append(.paragraph(parseInline(paraLines.joined(separator: "\n"))))
            }
        }

        return blocks
    }

    // MARK: - Inline Parsing

    /// Parse inline markdown elements from a string.
    static func parseInline(_ input: String) -> [MarkdownInline] {
        var elements: [MarkdownInline] = []
        var current = ""
        let chars = Array(input)
        var i = 0

        func flush() {
            if !current.isEmpty {
                elements.append(.text(current))
                current = ""
            }
        }

        while i < chars.count {
            // Inline code (backtick)
            if chars[i] == "`" {
                flush()
                i += 1
                var code = ""
                while i < chars.count && chars[i] != "`" {
                    code.append(chars[i])
                    i += 1
                }
                if i < chars.count { i += 1 } // skip closing `
                elements.append(.code(code))
                continue
            }

            // Link: [text](url)
            if chars[i] == "[" {
                if let link = tryParseLink(chars, from: i) {
                    flush()
                    elements.append(.link(text: link.text, url: link.url))
                    i = link.end
                    continue
                }
            }

            // Bold italic: ***text***
            if i + 2 < chars.count && chars[i] == "*" && chars[i + 1] == "*" && chars[i + 2] == "*" {
                if let result = tryParseDelimited(chars, from: i, count: 3) {
                    flush()
                    elements.append(.boldItalic(result.content))
                    i = result.end
                    continue
                }
            }

            // Bold: **text**
            if i + 1 < chars.count && chars[i] == "*" && chars[i + 1] == "*" {
                if let result = tryParseDelimited(chars, from: i, count: 2) {
                    flush()
                    elements.append(.bold(result.content))
                    i = result.end
                    continue
                }
            }

            // Italic: *text*
            if chars[i] == "*" {
                if let result = tryParseDelimited(chars, from: i, count: 1) {
                    flush()
                    elements.append(.italic(result.content))
                    i = result.end
                    continue
                }
            }

            current.append(chars[i])
            i += 1
        }

        flush()
        return elements
    }

    // MARK: - Inline Helpers

    private static func tryParseLink(
        _ chars: [Character], from start: Int
    ) -> (text: String, url: String, end: Int)? {
        var i = start + 1 // skip [
        var text = ""
        while i < chars.count && chars[i] != "]" {
            if chars[i] == "\n" { return nil }
            text.append(chars[i])
            i += 1
        }
        guard i < chars.count else { return nil }
        i += 1 // skip ]
        guard i < chars.count && chars[i] == "(" else { return nil }
        i += 1 // skip (
        var url = ""
        while i < chars.count && chars[i] != ")" {
            if chars[i] == "\n" { return nil }
            url.append(chars[i])
            i += 1
        }
        guard i < chars.count else { return nil }
        i += 1 // skip )
        guard !text.isEmpty else { return nil }
        return (text, url, i)
    }

    private static func tryParseDelimited(
        _ chars: [Character], from start: Int, count: Int
    ) -> (content: String, end: Int)? {
        let afterOpen = start + count
        guard afterOpen < chars.count else { return nil }

        // Opening delimiter must not be followed by whitespace
        guard !chars[afterOpen].isWhitespace else { return nil }

        var i = afterOpen
        var content = ""

        while i <= chars.count - count {
            // Check for closing delimiter
            var match = true
            for j in 0..<count {
                if chars[i + j] != "*" {
                    match = false
                    break
                }
            }

            if match && !content.isEmpty {
                // Closing delimiter must not be preceded by whitespace
                guard let last = content.last, !last.isWhitespace else {
                    content.append(chars[i])
                    i += 1
                    continue
                }
                return (content, i + count)
            }

            // Don't cross newlines for inline formatting
            if chars[i] == "\n" { return nil }

            content.append(chars[i])
            i += 1
        }

        return nil
    }

    // MARK: - Block Helpers

    private static func parseHeading(_ line: String) -> (level: Int, text: String)? {
        guard line.hasPrefix("#") else { return nil }
        var level = 0
        for ch in line {
            if ch == "#" { level += 1 }
            else { break }
        }
        guard level >= 1 && level <= 6 else { return nil }
        let rest = line.dropFirst(level)
        guard rest.first == " " else { return nil }
        return (level, String(rest.dropFirst()))
    }

    private static func isHorizontalRule(_ line: String) -> Bool {
        let stripped = line.filter { !$0.isWhitespace }
        guard stripped.count >= 3, let ch = stripped.first else { return false }
        guard ch == "-" || ch == "*" || ch == "_" else { return false }
        return stripped.allSatisfy { $0 == ch }
    }

    private static func isUnorderedListItem(_ line: String) -> Bool {
        line.hasPrefix("- ") || line.hasPrefix("* ")
    }

    private static func isOrderedListItem(_ line: String) -> Bool {
        guard let dotIndex = line.firstIndex(of: ".") else { return false }
        let prefix = line[line.startIndex..<dotIndex]
        guard !prefix.isEmpty && prefix.allSatisfy(\.isNumber) else { return false }
        let afterDot = line.index(after: dotIndex)
        return afterDot < line.endIndex && line[afterDot] == " "
    }

    private static func stripBullet(_ line: String) -> String {
        if line.hasPrefix("- ") || line.hasPrefix("* ") {
            return String(line.dropFirst(2))
        }
        return line
    }

    private static func stripOrderedPrefix(_ line: String) -> String {
        guard let dotIndex = line.firstIndex(of: ".") else { return line }
        let afterDot = line.index(after: dotIndex)
        guard afterDot < line.endIndex && line[afterDot] == " " else { return line }
        return String(line[line.index(after: afterDot)...])
    }
}
