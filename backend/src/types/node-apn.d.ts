/**
 * Type declarations for @parse/node-apn
 *
 * This is a minimal type declaration for the parts of the API we use.
 * The @parse/node-apn library is a fork of node-apn with updated dependencies.
 */

declare module "@parse/node-apn" {
  export interface ProviderOptions {
    token?: {
      key: string;
      keyId: string;
      teamId: string;
    };
    cert?: string;
    key?: string;
    ca?: string | string[];
    pfx?: string | Buffer;
    passphrase?: string;
    production?: boolean;
    address?: string;
    port?: number;
    rejectUnauthorized?: boolean;
    connectionRetryLimit?: number;
    heartBeat?: number;
    requestTimeout?: number;
  }

  export interface NotificationAlertObject {
    title?: string;
    subtitle?: string;
    body?: string;
    "title-loc-key"?: string;
    "title-loc-args"?: string[];
    "subtitle-loc-key"?: string;
    "subtitle-loc-args"?: string[];
    "loc-key"?: string;
    "loc-args"?: string[];
    "action-loc-key"?: string;
    "launch-image"?: string;
  }

  export class Notification {
    constructor(payload?: object);

    /** The destination topic for the notification */
    topic: string;

    /** Notification ID */
    id?: string;

    /** Alert message */
    alert: string | NotificationAlertObject;

    /** Badge count */
    badge?: number;

    /** Sound to play */
    sound?: string;

    /** Content available for silent push */
    contentAvailable?: boolean;

    /** Mutable content for notification service extension */
    mutableContent?: boolean;

    /** URL scheme */
    urlArgs?: string[];

    /** Thread ID for grouping */
    threadId?: string;

    /** Category for actionable notifications */
    category?: string;

    /** Expiry timestamp (seconds since epoch) */
    expiry?: number;

    /** Priority (10 for immediate, 5 for power-saving) */
    priority?: number;

    /** Collapse ID for coalescing */
    collapseId?: string;

    /** Push type */
    pushType?: "alert" | "background" | "voip" | "complication" | "fileprovider" | "mdm";

    /** Custom payload */
    payload?: Record<string, unknown>;

    /** Raw payload */
    rawPayload?: Record<string, unknown>;
  }

  export interface ResponseSent {
    device: string;
  }

  export interface ResponseFailed {
    device: string;
    status?: string;
    response?: {
      reason?: string;
    };
    error?: Error;
  }

  export interface MultiProviderResponse {
    sent: ResponseSent[];
    failed: ResponseFailed[];
  }

  export class Provider {
    constructor(options: ProviderOptions);

    /**
     * Send a notification to one or more devices
     */
    send(
      notification: Notification,
      recipients: string | string[]
    ): Promise<MultiProviderResponse>;

    /**
     * Shutdown the provider
     */
    shutdown(): void;
  }

  export default {
    Provider,
    Notification,
  };
}
