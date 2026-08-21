import type { StorageAdapter } from '../types';
import { LocalOnlyAdapter } from './local';

/**
 * Phase 3 adds GoogleDriveAdapter here and picks between them based on the
 * configured backend. Until then there is exactly one.
 */
export function getAdapter(): StorageAdapter {
  return new LocalOnlyAdapter();
}
