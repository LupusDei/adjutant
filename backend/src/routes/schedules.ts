/**
 * REST routes for cron schedule management.
 *
 * GET    /api/schedules      - List all recurring schedules
 * DELETE /api/schedules/:id  - Cancel and delete a schedule
 */

import { Router } from "express";

import type { CronScheduleStore } from "../services/adjutant/cron-schedule-store.js";
import type { StimulusEngine } from "../services/adjutant/stimulus-engine.js";

export function createSchedulesRouter(
  cronScheduleStore: CronScheduleStore,
  stimulusEngine: StimulusEngine,
): Router {
  const router = Router();

  // GET /api/schedules — list all schedules
  router.get("/", (_req, res) => {
    const schedules = cronScheduleStore.listAll();
    res.json({ success: true, data: schedules });
  });

  // DELETE /api/schedules/:id — cancel a schedule
  router.delete("/:id", (req, res) => {
    const id = req.params.id ?? "";
    const deleted = cronScheduleStore.delete(id);
    if (!deleted) {
      res.status(404).json({ success: false, error: "Schedule not found" });
      return;
    }
    stimulusEngine.cancelRecurringSchedule(id);
    res.json({ success: true, id });
  });

  return router;
}
