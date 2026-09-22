/**
 * STUB — replaced by the secret-chat implementation on merge.
 *
 * Backups depend only on these two signatures. Until secret chats land there
 * are no keys on the device, so the bundle is empty and importing is a no-op.
 */
export async function exportKeyBundle(): Promise<{
  version: 1;
  deviceId: string;
  keys: unknown;
  sessions: unknown;
}> {
  return { version: 1, deviceId: '', keys: null, sessions: null };
}

export async function importKeyBundle(_bundle: unknown): Promise<void> {
  /* nothing to import into yet */
}
