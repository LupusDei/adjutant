import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import type { MemoryStore, Learning } from "./memory-store.js";

// ============================================================================
// Constants
// ============================================================================

/** Minimum confidence to export a learning to file */
const MIN_EXPORT_CONFIDENCE = 0.7;

/** Minimum reinforcement count to export a learning */
const MIN_REINFORCEMENT_COUNT = 3;

/** Below this confidence, a topic file is pruned */
const PRUNE_CONFIDENCE_THRESHOLD = 0.3;

/** Maximum lines allowed in MEMORY.md */
const MAX_MEMORY_LINES = 180;

/** Maximum length for a sanitized topic filename (excluding .md extension) */
const MAX_TOPIC_FILENAME_LENGTH = 100;

/** Sentinel marking the start of auto-generated content in MEMORY.md */
const AUTO_SECTION_HEADER = "## Auto-Generated Learnings";

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  topicsWritten: number;
  learningsExported: number;
  topicsPruned: number;
}

// ============================================================================
// Core sync function
// ============================================================================

/**
 * Sync high-confidence learnings from the database to markdown files.
 *
 * This utility is called by the memory-reviewer behavior, not used as a
 * standalone behavior itself.
 *
 * Steps:
 * 1. Query learnings with confidence > 0.7 and reinforcement_count > 2
 * 2. Group by topic
 * 3. Write per-topic .md files
 * 4. Update MEMORY.md with auto-generated section
 * 5. Prune topic files where all learnings dropped below 0.3 confidence
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function syncMemoryFiles(
  memoryStore: MemoryStore,
  memoryDir: string,
  memoryMdPath: string,
): Promise<SyncResult> {
  // Ensure directory exists
  mkdirSync(memoryDir, { recursive: true });

  // 1. Query qualifying learnings (not superseded, above confidence threshold)
  const allLearnings = memoryStore.queryLearnings({
    minConfidence: MIN_EXPORT_CONFIDENCE,
    includeSuperseded: false,
  });

  // Filter by reinforcement count (queryLearnings doesn't support this filter)
  const qualifyingLearnings = allLearnings.filter(
    (l) => l.reinforcementCount >= MIN_REINFORCEMENT_COUNT,
  );

  // 2. Group by topic
  const topicGroups = new Map<string, Learning[]>();
  for (const learning of qualifyingLearnings) {
    const existing = topicGroups.get(learning.topic) ?? [];
    existing.push(learning);
    topicGroups.set(learning.topic, existing);
  }

  // 3. Write per-topic .md files (sorted by confidence descending within each)
  let learningsExported = 0;
  const writtenFilenames = new Set<string>();
  for (const [topic, learnings] of topicGroups) {
    const sorted = learnings.sort((a, b) => b.confidence - a.confidence);
    const lines = [
      `# ${topic}`,
      "",
      `> Auto-generated from ${sorted.length} high-confidence learnings.`,
      "",
    ];
    for (const l of sorted) {
      lines.push(`- ${l.content} (confidence: ${l.confidence.toFixed(2)})`);
    }
    lines.push("");

    const topicFilePath = safeTopicPath(memoryDir, topic);
    writeFileSync(topicFilePath, lines.join("\n"), "utf-8");
    writtenFilenames.add(basename(topicFilePath));
    learningsExported += sorted.length;
  }

  // 4. Prune topic files for topics where all learnings are below PRUNE_CONFIDENCE_THRESHOLD
  let topicsPruned = 0;
  const existingTopicFiles = getExistingTopicFiles(memoryDir);
  for (const topicFile of existingTopicFiles) {
    const topic = basename(topicFile, ".md");
    // Skip MEMORY.md itself
    if (topic === "MEMORY") continue;

    // If this file was just written, skip pruning
    if (writtenFilenames.has(topicFile)) continue;

    // Check if ALL learnings for this topic are below prune threshold
    const topicLearnings = memoryStore.queryLearnings({
      topic,
      includeSuperseded: false,
    });

    const allBelowThreshold = topicLearnings.length === 0 || topicLearnings.every(
      (l) => l.confidence < PRUNE_CONFIDENCE_THRESHOLD,
    );

    if (allBelowThreshold) {
      unlinkSync(join(memoryDir, topicFile));
      topicsPruned++;
    }
  }

  // 5. Update MEMORY.md
  updateMemoryMd(memoryMdPath, topicGroups, memoryDir);

  return {
    topicsWritten: topicGroups.size,
    learningsExported,
    topicsPruned,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sanitize a topic string for use as a filename.
 * Strips path separators, limits to alphanumeric + hyphens, and truncates length.
 */
export function sanitizeTopicFilename(topic: string): string {
  // Remove path separators and dots used for traversal
  let safe = topic.replace(/[/\\]/g, "");
  // Remove leading dots to prevent hidden files or traversal
  safe = safe.replace(/^\.+/, "");
  // Replace any remaining non-alphanumeric, non-hyphen characters with empty string
  safe = safe.replace(/[^a-zA-Z0-9-]/g, "");
  // Truncate to max length
  if (safe.length > MAX_TOPIC_FILENAME_LENGTH) {
    safe = safe.slice(0, MAX_TOPIC_FILENAME_LENGTH);
  }
  // Fallback if completely empty after sanitization
  if (safe.length === 0) {
    safe = "unnamed-topic";
  }
  return safe;
}

/**
 * Build a safe file path for a topic file, validating it stays within memoryDir.
 */
function safeTopicPath(memoryDir: string, topic: string): string {
  const safeName = sanitizeTopicFilename(topic);
  const filePath = join(memoryDir, `${safeName}.md`);
  // Final defense: ensure resolved path is within memoryDir
  const resolved = resolve(filePath);
  const resolvedDir = resolve(memoryDir);
  if (!resolved.startsWith(resolvedDir + "/") && resolved !== resolvedDir) {
    return join(memoryDir, "unnamed-topic.md");
  }
  return filePath;
}

/**
 * Get all .md files in the memory directory (excluding MEMORY.md).
 */
function getExistingTopicFiles(memoryDir: string): string[] {
  if (!existsSync(memoryDir)) return [];
  return readdirSync(memoryDir).filter(
    (f) => f.endsWith(".md") && f !== "MEMORY.md",
  );
}

/**
 * Update MEMORY.md: preserve manual sections, replace auto-generated section.
 * Ensures total file stays under MAX_MEMORY_LINES.
 */
function updateMemoryMd(
  memoryMdPath: string,
  topicGroups: Map<string, Learning[]>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _memoryDir: string,
): void {
  let manualContent = "";

  if (existsSync(memoryMdPath)) {
    const existing = readFileSync(memoryMdPath, "utf-8");
    // Extract everything before the auto-generated section
    const autoIdx = existing.indexOf(AUTO_SECTION_HEADER);
    if (autoIdx !== -1) {
      manualContent = existing.substring(0, autoIdx).trimEnd();
    } else {
      manualContent = existing.trimEnd();
    }
  }

  // Build auto-generated section
  const autoLines: string[] = [
    "",
    AUTO_SECTION_HEADER,
    "",
  ];

  if (topicGroups.size === 0) {
    autoLines.push("_No high-confidence learnings to export yet._");
    autoLines.push("");
  } else {
    // Sort topics alphabetically for consistent output
    const sortedTopics = [...topicGroups.keys()].sort();
    for (const topic of sortedTopics) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const learnings = topicGroups.get(topic)!;
      autoLines.push(`### ${topic}`);
      // Sort by confidence descending
      const sorted = learnings.sort((a, b) => b.confidence - a.confidence);
      for (const l of sorted) {
        autoLines.push(`- ${l.content}`);
      }
      autoLines.push("");
    }
  }

  // Combine manual + auto
  const fullContent = manualContent + "\n" + autoLines.join("\n");
  let lines = fullContent.split("\n");

  // Remove trailing empty lines before counting
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  // Enforce MAX_MEMORY_LINES (we'll add one trailing newline at the end,
  // so we budget for MAX_MEMORY_LINES - 1 content lines + 1 trailing empty = 180 on split)
  const maxContentLines = MAX_MEMORY_LINES - 1;
  if (lines.length > maxContentLines) {
    // Find where auto section starts
    const autoStartIdx = lines.findIndex((l) => l === AUTO_SECTION_HEADER);
    if (autoStartIdx !== -1) {
      // Keep manual lines intact, truncate auto section
      const manualLines = lines.slice(0, autoStartIdx);
      const remainingBudget = maxContentLines - manualLines.length;
      if (remainingBudget > 3) {
        // Include header + as many auto lines as we can
        const autoSection = lines.slice(autoStartIdx, autoStartIdx + remainingBudget);
        lines = [...manualLines, ...autoSection];
      } else {
        // Not enough room for auto section
        lines = manualLines.slice(0, maxContentLines);
      }
    } else {
      lines = lines.slice(0, maxContentLines);
    }
  }

  writeFileSync(memoryMdPath, lines.join("\n") + "\n", "utf-8");
}
