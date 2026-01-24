/**
 * Tunnel service for Adjutant.
 *
 * Controls ngrok tunnel startup/shutdown for remote access.
 * Manages the ngrok child process and queries its status.
 */

import { spawn, type ChildProcess } from "child_process";

// ============================================================================
// Types
// ============================================================================

export type TunnelState = "stopped" | "starting" | "running" | "error";

export interface TunnelStatus {
  state: TunnelState;
  publicUrl?: string;
  error?: string;
}

export interface TunnelServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface NgrokTunnel {
  public_url: string;
  proto: string;
  config: { addr: string };
}

interface NgrokApiResponse {
  tunnels: NgrokTunnel[];
}

// ============================================================================
// State
// ============================================================================

let ngrokProcess: ChildProcess | null = null;
let currentState: TunnelState = "stopped";
let lastError: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check ngrok API for tunnel status.
 */
async function checkNgrokApi(): Promise<{ url: string | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch("http://127.0.0.1:4040/api/tunnels", {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { url: null, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as NgrokApiResponse;
    const httpsTunnel = data.tunnels.find((t) => t.proto === "https");
    const httpTunnel = data.tunnels.find((t) => t.proto === "http");
    const tunnel = httpsTunnel ?? httpTunnel;

    if (tunnel) {
      return { url: tunnel.public_url, error: null };
    }
    return { url: null, error: "No tunnels found" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { url: null, error: "Timeout connecting to ngrok" };
    }
    return { url: null, error: err instanceof Error ? err.message : "Failed to connect" };
  }
}

/**
 * Wait for ngrok to become available.
 */
async function waitForNgrok(maxAttempts = 10, delayMs = 500): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await checkNgrokApi();
    if (result.url) {
      return result.url;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

// ============================================================================
// Tunnel Service Functions
// ============================================================================

/**
 * Get current tunnel status.
 */
export async function getStatus(): Promise<TunnelServiceResult<TunnelStatus>> {
  // If we think ngrok is running, verify it
  if (currentState === "running" || ngrokProcess) {
    const result = await checkNgrokApi();
    if (result.url) {
      currentState = "running";
      return {
        success: true,
        data: {
          state: "running",
          publicUrl: result.url,
        },
      };
    }
    // ngrok not responding but we thought it was running
    if (ngrokProcess) {
      currentState = "error";
      lastError = result.error ?? "Tunnel not responding";
    } else {
      currentState = "stopped";
    }
  }

  // Also check if ngrok is running externally (not started by us)
  if (currentState === "stopped") {
    const result = await checkNgrokApi();
    if (result.url) {
      currentState = "running";
      return {
        success: true,
        data: {
          state: "running",
          publicUrl: result.url,
        },
      };
    }
  }

  const statusData: TunnelStatus = {
    state: currentState,
  };
  if (lastError) {
    statusData.error = lastError;
  }
  return {
    success: true,
    data: statusData,
  };
}

/**
 * Safely kill a child process without throwing.
 */
function safeKill(proc: ChildProcess | null): void {
  if (!proc) return;
  try {
    proc.kill();
  } catch {
    // Process already dead or other error - ignore
  }
}

/**
 * Start the ngrok tunnel.
 */
export async function startTunnel(): Promise<TunnelServiceResult<TunnelStatus>> {
  try {
    // Check if already running
    const status = await getStatus();
    if (status.data?.state === "running") {
      return {
        success: false,
        error: {
          code: "ALREADY_RUNNING",
          message: "Tunnel is already running",
        },
      };
    }

    // Clean up any existing process
    safeKill(ngrokProcess);
    ngrokProcess = null;

    currentState = "starting";
    lastError = null;

    // Spawn ngrok process
    ngrokProcess = spawn("ngrok", ["http", "3000"], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Handle process exit
    ngrokProcess.on("exit", (code) => {
      if (code !== 0 && currentState !== "stopped") {
        currentState = "error";
        lastError = `ngrok exited with code ${code}`;
      } else {
        currentState = "stopped";
      }
      ngrokProcess = null;
    });

    ngrokProcess.on("error", (err) => {
      currentState = "error";
      lastError = err.message;
      ngrokProcess = null;
    });

    // Capture stderr for error messages
    ngrokProcess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && currentState === "starting") {
        lastError = msg;
      }
    });

    // Wait for ngrok to start and get the URL
    const publicUrl = await waitForNgrok();

    if (publicUrl) {
      currentState = "running";
      return {
        success: true,
        data: {
          state: "running",
          publicUrl,
        },
      };
    }

    // Failed to get URL
    currentState = "error";
    lastError = lastError ?? "Failed to start ngrok tunnel";
    return {
      success: false,
      error: {
        code: "START_FAILED",
        message: lastError,
      },
    };
  } catch (err) {
    currentState = "error";
    lastError = err instanceof Error ? err.message : "Failed to start ngrok";
    return {
      success: false,
      error: {
        code: "START_FAILED",
        message: lastError,
      },
    };
  }
}

/**
 * Stop the ngrok tunnel.
 */
export async function stopTunnel(): Promise<TunnelServiceResult<TunnelStatus>> {
  // Check current state
  const status = await getStatus();
  if (status.data?.state === "stopped") {
    return {
      success: false,
      error: {
        code: "ALREADY_STOPPED",
        message: "Tunnel is already stopped",
      },
    };
  }

  // Kill the process
  safeKill(ngrokProcess);
  ngrokProcess = null;

  // Also try to kill any ngrok processes we didn't start
  try {
    // Use pkill to stop any ngrok http 3000 processes
    const pkill = spawn("pkill", ["-f", "ngrok http 3000"]);
    await new Promise((resolve) => pkill.on("close", resolve));
  } catch {
    // Ignore errors from pkill
  }

  currentState = "stopped";
  lastError = null;

  return {
    success: true,
    data: {
      state: "stopped",
    },
  };
}
