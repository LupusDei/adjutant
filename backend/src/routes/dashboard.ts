/**
 * Dashboard route — single endpoint that returns all dashboard data.
 *
 * GET /api/dashboard
 */

import { Router } from "express";
import type { DashboardService } from "../services/dashboard-service.js";
import { success } from "../utils/responses.js";

export function createDashboardRouter(dashboardService: DashboardService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const data = await dashboardService.fetchDashboard();
    return res.json(success(data));
  });

  return router;
}
