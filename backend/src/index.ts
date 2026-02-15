import "dotenv/config";
import cors from "cors";
import express from "express";
import { agentsRouter, beadsRouter, convoysRouter, costsRouter, devicesRouter, eventsRouter, mailRouter, modeRouter, permissionsRouter, powerRouter, projectsRouter, sessionsRouter, statusRouter, swarmsRouter, tunnelRouter, voiceRouter } from "./routes/index.js";
import { apiKeyAuth } from "./middleware/index.js";
import { logInfo } from "./utils/index.js";
import { startCacheCleanupScheduler } from "./services/audio-cache.js";
import { startPrefixMapRefreshScheduler } from "./services/beads-service.js";
import { initWebSocketServer } from "./services/ws-server.js";
import { initStreamingBridge } from "./services/streaming-bridge.js";
import { getSessionBridge } from "./services/session-bridge.js";

const app = express();
const PORT = process.env["PORT"] ?? 4201;

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    logInfo("request completed", {
      method: req.method,
      path: req.originalUrl ?? req.url,
      status: res.statusCode,
      durationMs,
    });
  });
  next();
});
app.use(apiKeyAuth);

// Routes
app.use("/api/beads", beadsRouter);
app.use("/api/convoys", convoysRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/events", eventsRouter);
app.use("/api/mail", mailRouter);
app.use("/api/mode", modeRouter);
app.use("/api/power", powerRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/status", statusRouter);
app.use("/api/tunnel", tunnelRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/swarms", swarmsRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/costs", costsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(PORT, () => {
  logInfo("backend server listening", { port: PORT });

  // Start audio cache cleanup scheduler (T056)
  startCacheCleanupScheduler();

  // Start prefix map refresh scheduler (adj-sha0s)
  startPrefixMapRefreshScheduler();

  // Initialize WebSocket server on the same HTTP server
  initWebSocketServer(server);

  // Initialize streaming bridge (watches .beads/streams/ for agent output)
  initStreamingBridge();

  // Initialize Session Bridge v2 (tmux session management)
  try {
    getSessionBridge();
  } catch (err) {
    logInfo("session bridge init failed (non-fatal)", { error: String(err) });
  }
});
