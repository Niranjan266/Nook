/** Drive links for backups. The token arrives here already sealed. */
import { one, run, now } from './index.js';

export async function findDriveLink(userId) {
  const row = await one('SELECT * FROM drive_links WHERE user_id = ?', [userId]);
  return row && { userId: row.user_id, refreshTokenEnc: row.refresh_token_enc, connectedAt: row.connected_at };
}

// Reconnecting replaces the old token rather than keeping two: Google has
// already issued a fresh one, and the old grant is what the person just redid.
export async function saveDriveLink(userId, refreshTokenEnc) {
  await run(
    `INSERT INTO drive_links (user_id, refresh_token_enc, connected_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc,
                                         connected_at = excluded.connected_at`,
    [userId, refreshTokenEnc, now()]
  );
}

export async function deleteDriveLink(userId) {
  await run('DELETE FROM drive_links WHERE user_id = ?', [userId]);
}
