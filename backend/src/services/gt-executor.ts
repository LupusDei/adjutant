import { spawn } from 'child_process';

/**
 * Result of executing a GT command.
 */
export interface GtResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    stderr?: string;
  };
  exitCode: number;
}

/**
 * Options for GT command execution.
 */
export interface GtExecOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to parse stdout as JSON (default: true for commands with --json) */
  parseJson?: boolean;
}

const DEFAULT_TIMEOUT = 30000;

/**
 * Executes a GT command and returns the result.
 *
 * @param args - Command arguments (e.g., ['status', '--json'])
 * @param options - Execution options
 * @returns Promise resolving to the command result
 */
export async function execGt<T = unknown>(
  args: string[],
  options: GtExecOptions = {}
): Promise<GtResult<T>> {
  const { cwd, timeout = DEFAULT_TIMEOUT, parseJson = true } = options;

  return new Promise((resolve) => {
    const child = spawn('gt', args, {
      cwd,
      timeout,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        error: {
          code: 'SPAWN_ERROR',
          message: err.message,
        },
        exitCode: -1,
      });
    });

    child.on('close', (code) => {
      const exitCode = code ?? 0;

      if (exitCode !== 0) {
        const stderrTrimmed = stderr.trim();
        resolve({
          success: false,
          error: {
            code: 'COMMAND_FAILED',
            message: stderrTrimmed || `Command exited with code ${exitCode}`,
            ...(stderrTrimmed ? { stderr: stderrTrimmed } : {}),
          },
          exitCode,
        });
        return;
      }

      // Parse JSON output if requested
      if (parseJson && stdout.trim()) {
        try {
          const data = JSON.parse(stdout) as T;
          resolve({ success: true, data, exitCode });
        } catch {
          resolve({
            success: false,
            error: {
              code: 'PARSE_ERROR',
              message: 'Failed to parse JSON output',
              stderr: stdout.substring(0, 500),
            },
            exitCode,
          });
        }
      } else {
        // Return raw stdout as data for non-JSON commands
        resolve({
          success: true,
          data: stdout.trim() as unknown as T,
          exitCode,
        });
      }
    });
  });
}

/**
 * GT command executor with typed methods for each operation.
 */
export const gt = {
  /**
   * Get gastown status.
   */
  async status<T = unknown>(options?: GtExecOptions): Promise<GtResult<T>> {
    return execGt<T>(['status', '--json'], options);
  },

  /**
   * Start gastown (gt up).
   */
  async up(options?: GtExecOptions): Promise<GtResult<string>> {
    return execGt<string>(['up'], { ...options, parseJson: false });
  },

  /**
   * Stop gastown (gt down).
   */
  async down(options?: GtExecOptions): Promise<GtResult<string>> {
    return execGt<string>(['down'], { ...options, parseJson: false });
  },

  /**
   * Mail operations.
   */
  mail: {
    /**
     * Get inbox messages.
     */
    async inbox<T = unknown>(options?: GtExecOptions): Promise<GtResult<T>> {
      return execGt<T>(['mail', 'inbox', '--json'], options);
    },

    /**
     * Read a specific message.
     */
    async read<T = unknown>(
      messageId: string,
      options?: GtExecOptions
    ): Promise<GtResult<T>> {
      return execGt<T>(['mail', 'read', messageId, '--json'], options);
    },

    /**
     * Send a message.
     */
    async send(
      to: string,
      subject: string,
      body: string,
      sendOptions?: {
        type?: 'notification' | 'task' | 'scavenge' | 'reply';
        priority?: 0 | 1 | 2 | 3 | 4;
        replyTo?: string;
      },
      options?: GtExecOptions
    ): Promise<GtResult<string>> {
      const args = ['mail', 'send', to, '-s', subject, '-m', body];

      if (sendOptions?.type) {
        args.push('--type', sendOptions.type);
      }
      if (sendOptions?.priority !== undefined) {
        args.push('--priority', sendOptions.priority.toString());
      }
      if (sendOptions?.replyTo) {
        args.push('--reply-to', sendOptions.replyTo);
      }

      return execGt<string>(args, { ...options, parseJson: false });
    },

    /**
     * Mark a message as read.
     */
    async markRead(
      messageId: string,
      options?: GtExecOptions
    ): Promise<GtResult<string>> {
      return execGt<string>(['mail', 'mark-read', messageId], {
        ...options,
        parseJson: false,
      });
    },

    /**
     * Get a thread of messages.
     */
    async thread<T = unknown>(
      threadId: string,
      options?: GtExecOptions
    ): Promise<GtResult<T>> {
      return execGt<T>(['mail', 'thread', threadId, '--json'], options);
    },
  },

  /**
   * Agent operations.
   */
  agents: {
    /**
     * List all agents.
     */
    async list<T = unknown>(options?: GtExecOptions): Promise<GtResult<T>> {
      return execGt<T>(['agents', 'list', '--all', '--json'], options);
    },

    /**
     * Check agent health.
     */
    async check<T = unknown>(options?: GtExecOptions): Promise<GtResult<T>> {
      return execGt<T>(['agents', 'check', '--json'], options);
    },
  },

  /**
   * Execute an arbitrary GT command.
   */
  exec: execGt,
};

export default gt;
