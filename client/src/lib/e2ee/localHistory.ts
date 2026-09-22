/**
 * STUB — replaced by the secret-chat implementation on merge.
 *
 * Decrypted secret-chat messages live only on the device; this is the seam a
 * backup reads them through and a restore writes them back through.
 */
export async function exportSecretHistory(): Promise<unknown> {
  return null;
}

export async function importSecretHistory(_data: unknown): Promise<void> {
  /* nothing to import into yet */
}
