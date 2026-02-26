/**
 * Dashboard route — single endpoint that returns all dashboard data.
 *
 * GET /api/dashboard
 */

import { Router } from "express";
import type { DashboardService } from "../services/dashboard-service.js";
import { success, error as errorResponse } from "../utils/responses.js";

export function createDashboardRouter(dashboardService: DashboardService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const data = await dashboardService.fetchDashboard();
      return res.json(success(data));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json(errorResponse("DASHBOARD_FETCH_FAILED", message));
    }
  });

  return router;
}
