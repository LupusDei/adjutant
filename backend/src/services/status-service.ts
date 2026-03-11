/**
 * Status service for Adjutant.
 *
 * Provides crew member data transformation.
 * Delegates to agents-service for the actual implementation.
 */

import { getAgents } from "./agents-service.js";
import type { ServiceResult } from "../types/service-result.js";
import type { CrewMember } from "../types/index.js";

/** @deprecated Use ServiceResult<T> from types/service-result.js */
export type StatusServiceResult<T> = ServiceResult<T>;

/**
 * Gets all crew members.
 * Returns agents transformed into CrewMember format for dashboard display.
 */
export async function getCrewMembers(): Promise<StatusServiceResult<CrewMember[]>> {
  return getAgents();
}
