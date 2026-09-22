/** A person's sticker tray. Only ever read or written by its owner. */
import { all, one, run, newId, now } from './index.js';

const hydrate = (row) =>
  row && {
    id: row.id,
    url: row.url,
    publicId: row.public_id,
    width: row.width,
    height: row.height,
    createdAt: new Date(row.created_at).toISOString(),
  };

// Recently used first; a sticker that has never been sent sorts by when it was made.
export const listStickers = async (userId) =>
  (
    await all('SELECT * FROM stickers WHERE user_id = ? ORDER BY sort_order DESC, created_at DESC', [userId])
  ).map(hydrate);

export const countStickers = async (userId) =>
  (await one('SELECT COUNT(*) AS n FROM stickers WHERE user_id = ?', [userId]))?.n || 0;

export const findStickerByUpload = async (userId, publicId) =>
  hydrate(await one('SELECT * FROM stickers WHERE user_id = ? AND public_id = ?', [userId, publicId]));

/** The next slot at the top of the tray. */
const topOrder = async (userId) =>
  ((await one('SELECT MAX(sort_order) AS top FROM stickers WHERE user_id = ?', [userId]))?.top || 0) + 1;

export async function createSticker({ userId, url, publicId, width, height }) {
  const id = newId();
  await run(
    `INSERT INTO stickers (id, user_id, url, public_id, width, height, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, url, publicId, width, height, await topOrder(userId), now()]
  );
  return hydrate(await one('SELECT * FROM stickers WHERE id = ?', [id]));
}

/** Returns whether anything was touched — false means "not yours, or not there". */
export async function touchSticker(userId, id) {
  const r = await run('UPDATE stickers SET sort_order = ? WHERE id = ? AND user_id = ?', [
    await topOrder(userId),
    id,
    userId,
  ]);
  return r.rowsAffected > 0;
}

export async function deleteSticker(userId, id) {
  const r = await run('DELETE FROM stickers WHERE id = ? AND user_id = ?', [id, userId]);
  return r.rowsAffected > 0;
}
