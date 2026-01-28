#!/usr/bin/env node
/**
 * CLI for managing API keys.
 *
 * Usage:
 *   npx tsx src/cli/api-keys.ts generate [label]  - Generate a new API key
 *   npx tsx src/cli/api-keys.ts list              - List all keys (metadata only)
 *   npx tsx src/cli/api-keys.ts revoke <prefix>   - Revoke a key by hash prefix
 */

import { generateApiKey, listApiKeys, revokeApiKey } from "../services/api-key-service.js";

const [command, ...args] = process.argv.slice(2);

function printUsage(): void {
  console.log(`
API Key Management CLI

Usage:
  npx tsx src/cli/api-keys.ts generate [label]  Generate a new API key
  npx tsx src/cli/api-keys.ts list              List all registered keys
  npx tsx src/cli/api-keys.ts revoke <prefix>   Revoke a key by hash prefix

Examples:
  npx tsx src/cli/api-keys.ts generate ios-app
  npx tsx src/cli/api-keys.ts generate
  npx tsx src/cli/api-keys.ts list
  npx tsx src/cli/api-keys.ts revoke a1b2c3d4
`);
}

switch (command) {
  case "generate": {
    const label = args[0];
    const key = generateApiKey(label);
    console.log("\nAPI key generated successfully!");
    console.log("----------------------------------------------");
    console.log(`Key: ${key}`);
    if (label) {
      console.log(`Label: ${label}`);
    }
    console.log("----------------------------------------------");
    console.log("\nIMPORTANT: Save this key now. It cannot be retrieved later.");
    console.log("Use it in requests via: Authorization: Bearer <key>");
    break;
  }

  case "list": {
    const keys = listApiKeys();
    if (keys.length === 0) {
      console.log("\nNo API keys configured. API is running in open mode.");
      console.log("Generate a key with: npx tsx src/cli/api-keys.ts generate [label]");
    } else {
      console.log(`\n${keys.length} API key(s) registered:\n`);
      console.log("Hash Prefix  Label            Created");
      console.log("-".repeat(50));
      for (const key of keys) {
        const label = (key.label ?? "(no label)").padEnd(16);
        const created = key.createdAt.split("T")[0];
        console.log(`${key.hashPrefix}     ${label} ${created}`);
      }
    }
    break;
  }

  case "revoke": {
    const prefix = args[0];
    if (!prefix) {
      console.error("Error: Hash prefix required");
      console.error("Usage: npx tsx src/cli/api-keys.ts revoke <prefix>");
      process.exit(1);
    }
    const success = revokeApiKey(prefix);
    if (success) {
      console.log(`\nAPI key with prefix '${prefix}' revoked successfully.`);
    } else {
      console.error(`\nNo API key found with prefix '${prefix}'.`);
      process.exit(1);
    }
    break;
  }

  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;

  default:
    if (command) {
      console.error(`Unknown command: ${command}`);
    }
    printUsage();
    process.exit(command ? 1 : 0);
}
