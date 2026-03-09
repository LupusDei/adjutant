/**
 * Barrel export for all step definition modules.
 *
 * Import this module to register all built-in step definitions
 * (common, messaging, agent, bead) into the global step registry.
 *
 * @module acceptance/steps
 */

import "./common-steps.js";
import "./messaging-steps.js";
import "./agent-steps.js";
import "./bead-steps.js";
