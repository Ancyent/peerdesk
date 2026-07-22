import i18n from '../i18n';
import { ApiError } from './client';

// Exact server `detail` strings -> errors:server.* keys. Server stays English;
// we localize on the client the ones a web user actually sees. Keys here MUST
// stay byte-identical to both the real `raise HTTPException(..., detail=...)`
// strings in server/api/routers/*.py and the en/errors.json `server.*` values
// (single source of truth: what the server literally sends).
const SERVER_MESSAGE_KEYS: Record<string, string> = {
  'Email already in use': 'errors:server.emailInUse',
  'Unsupported language': 'errors:server.unsupportedLanguage',
  'Current password is incorrect': 'errors:server.currentPasswordIncorrect',
  'Email already registered': 'errors:server.emailAlreadyRegistered',
  'Invalid credentials': 'errors:server.invalidCredentials',
  'Invalid or expired invitation': 'errors:server.invalidOrExpiredInvitation',
  'Name and password are required': 'errors:server.nameAndPasswordRequired',
  'An account must keep at least one admin': 'errors:server.accountNeedsOneAdmin',
  'Grant target not found': 'errors:server.grantTargetNotFound',
};

export function localizeError(e: unknown): string {
  if (e instanceof ApiError) {
    const key = SERVER_MESSAGE_KEYS[e.message];
    return key ? i18n.t(key) : e.message;
  }
  return i18n.t('common:error');
}
