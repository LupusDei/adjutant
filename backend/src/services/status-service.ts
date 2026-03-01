/**
 * Status service for Adjutant.
 *
 * Provides crew member data transformation.
 * Delegates to agents-service for the actual implementation.
 */

import { getAgents } from "./agents-service.js";
import type { AgentsServiceResult } from "./agents-service.js";
import type { CrewMember } from "../types/index.js";

// Re-export the result type with a more specific name
export type StatusServiceResult<T> = AgentsServiceResult<T>;

/**
 * Gets all crew members.
 * Returns agents transformed into CrewMember format for dashboard display.
 */
export async function getCrewMembers(): Promise<StatusServiceResult<CrewMember[]>> {
  return getAgents();
}
