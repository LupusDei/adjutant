export { gt, execGt } from './gt-executor.js';
export type { GtResult, GtExecOptions } from './gt-executor.js';

export {
  mailService,
  listMail,
  getMessage,
  sendMail,
  markRead,
  getThread,
} from './mail-service.js';
export type { ListMailOptions, MailServiceError } from './mail-service.js';
