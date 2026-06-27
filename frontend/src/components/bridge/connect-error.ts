/**
 * describeConnectError (adj-202.3.7.6) — interpret a failed Bridge connect.
 *
 * A daily-ceiling 429 is an EXPECTED budget cap, not a broken link. Collapsing
 * both into "Link failed" leaves the Commander unable to tell "we hit our budget"
 * from "the link broke", so this maps the structured code/status into a distinct,
 * actionable message.
 */

export interface ConnectErrorView {
  /** `ceiling` = expected daily budget cap; `failure` = something actually broke. */
  kind: 'ceiling' | 'failure';
  title: string;
  detail: string | null;
}

export interface ConnectErrorInput {
  error: string | null;
  errorCode: string | null;
  errorStatus: number | null;
}

export function describeConnectError({
  error,
  errorCode,
  errorStatus,
}: ConnectErrorInput): ConnectErrorView {
  if (errorStatus === 429 || errorCode === 'DAILY_CREDIT_CEILING_REACHED') {
    return {
      kind: 'ceiling',
      title: 'Daily credit ceiling reached',
      detail:
        'The Bridge is paused to protect the avatar budget. It resets at the start of the next day (UTC).',
    };
  }
  return {
    kind: 'failure',
    title: 'Link failed',
    detail: error,
  };
}
