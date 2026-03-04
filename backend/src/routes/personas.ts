/**
 * Persona REST routes for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/personas          - List all personas
 * - POST   /api/personas          - Create a new persona
 * - GET    /api/personas/:id      - Get a persona by ID
 * - GET    /api/personas/:id/prompt - Get generated prompt for a persona
 * - PUT    /api/personas/:id      - Update a persona
 * - DELETE /api/personas/:id      - Delete a persona
 */

import { Router } from "express";
import { ZodError } from "zod";

import type { PersonaService } from "../services/persona-service.js";
import { generatePersonaPrompt } from "../services/prompt-generator.js";
import { success, notFound, conflict, validationError, internalError } from "../utils/responses.js";

/**
 * Create a personas router with the given PersonaService.
 * Factory pattern matches existing routes (createMessagesRouter, etc.).
 */
export function createPersonasRouter(service: PersonaService): Router {
  const router = Router();

  /**
   * GET /api/personas
   * Returns all personas sorted by name.
   */
  router.get("/", (_req, res) => {
    try {
      const personas = service.listPersonas();
      return res.json(success(personas));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list personas";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * POST /api/personas
   * Creates a new persona. Body: { name, description?, traits }
   */
  router.post("/", (req, res) => {
    try {
      const persona = service.createPersona(req.body);
      return res.status(201).json(success(persona));
    } catch (err) {
      if (err instanceof ZodError) {
        const firstIssue = err.issues[0];
        const message = firstIssue
          ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
          : "Validation failed";
        return res.status(400).json(validationError(message));
      }

      if (err instanceof Error && /already exists/i.test(err.message)) {
        return res.status(409).json(conflict(err.message));
      }

      const message = err instanceof Error ? err.message : "Failed to create persona";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * GET /api/personas/:id/prompt
   * Returns the generated persona prompt for hook injection.
   * Used by the SessionStart hook script to re-inject persona context.
   */
  router.get("/:id/prompt", (req, res) => {
    try {
      const persona = service.getPersona(req.params.id);
      if (persona === null) {
        return res.status(404).json(notFound("Persona", req.params.id));
      }
      const prompt = generatePersonaPrompt(persona);
      return res.json(success({ prompt }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate prompt";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * GET /api/personas/:id
   * Returns a single persona by ID.
   */
  router.get("/:id", (req, res) => {
    try {
      const persona = service.getPersona(req.params.id);
      if (persona === null) {
        return res.status(404).json(notFound("Persona", req.params.id));
      }
      return res.json(success(persona));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get persona";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * PUT /api/personas/:id
   * Updates an existing persona. Body: { name?, description?, traits? }
   */
  router.put("/:id", (req, res) => {
    try {
      const updated = service.updatePersona(req.params.id, req.body);
      if (updated === null) {
        return res.status(404).json(notFound("Persona", req.params.id));
      }
      return res.json(success(updated));
    } catch (err) {
      if (err instanceof ZodError) {
        const firstIssue = err.issues[0];
        const message = firstIssue
          ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
          : "Validation failed";
        return res.status(400).json(validationError(message));
      }

      if (err instanceof Error && /already exists/i.test(err.message)) {
        return res.status(409).json(conflict(err.message));
      }

      const message = err instanceof Error ? err.message : "Failed to update persona";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * DELETE /api/personas/:id
   * Deletes a persona by ID.
   */
  router.delete("/:id", (req, res) => {
    try {
      const deleted = service.deletePersona(req.params.id);
      if (!deleted) {
        return res.status(404).json(notFound("Persona", req.params.id));
      }
      return res.json(success({ deleted: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete persona";
      return res.status(500).json(internalError(message));
    }
  });

  return router;
}
