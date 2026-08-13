import { get } from './api';
import { clock, dayLabel, sameDay, previewOf } from './format';
import type { Conversation, Message } from './types';

/**
 * Export a conversation to a single self-contained HTML file.
 *
 * Built on the client on purpose: the whole promise is "your data leaves", and
 * an export that requires a server round-trip to some export service rather
 * undermines that. Everything is inlined, so the file opens in any browser
 * offline, forever, with no Nook involved.
 */

const escape = (s = '') =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

async function fetchAll(conversationId: string): Promise<Message[]> {
  const all: Message[] = [];
  let before: string | undefined;

  // Page backwards until the server says there's nothing older.
  for (let page = 0; page < 200; page++) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const data = await get<{ messages: Message[]; hasMore: boolean }>(
      `/messages/${conversationId}?${query}`
    );
    all.unshift(...data.messages);
    if (!data.hasMore || !data.messages.length) break;
    before = data.messages[0].createdAt;
  }
  return all;
}

function renderMessage(m: Message, meId: string) {
  const mine = m.sender.id === meId;
  const who = escape(m.sender.displayName || (mine ? 'You' : 'Them'));

  let body = '';
  if (m.type === 'text') body = escape(m.body).replace(/\n/g, '<br>');
  else if (m.media?.url)
    body = `<a class="file" href="${escape(m.media.url)}">${escape(m.media.name || previewOf(m))}</a>`;
  else body = `<em>${escape(previewOf(m))}</em>`;

  if (m.deletedForAll) body = '<em class="gone">This message was unsent</em>';

  const reply = m.replyTo?.senderName
    ? `<div class="quote"><b>${escape(m.replyTo.senderName)}</b> ${escape(m.replyTo.body || '')}</div>`
    : '';

  const reactions = m.reactions.length
    ? `<div class="reactions">${m.reactions.map((r) => escape(r.emoji)).join(' ')}</div>`
    : '';

  return `<div class="msg ${mine ? 'mine' : 'theirs'}">
    <div class="who">${who}<time>${clock(m.createdAt)}</time></div>
    ${reply}
    <div class="body">${body}${m.editedAt ? ' <span class="edited">(edited)</span>' : ''}</div>
    ${reactions}
  </div>`;
}

export async function exportConversation(conversation: Conversation) {
  const meId = (window as any).__nookMeId as string;
  const messages = await fetchAll(conversation.id);

  const rows: string[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    if (!prev || !sameDay(prev.createdAt, m.createdAt)) {
      rows.push(`<div class="day">${escape(dayLabel(m.createdAt))}</div>`);
    }
    rows.push(renderMessage(m, meId));
  });

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(conversation.name)} — Nook export</title>
<style>
  :root{--bg:#E9E1D6;--surface:#F4EEE6;--raised:#FAF6F0;--ink:#1E1A17;--soft:#5C5349;--faint:#8B8073;--accent:#C0603C}
  @media (prefers-color-scheme:dark){:root{--bg:#201D1A;--surface:#2B2724;--raised:#35302B;--ink:#EFE6DA;--soft:#A79C8E;--faint:#7D7367;--accent:#D97A53}}
  *{box-sizing:border-box}
  body{margin:0;padding:32px 16px 64px;background:var(--bg);color:var(--ink);
       font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}
  .wrap{max-width:720px;margin:0 auto}
  header{text-align:center;margin-bottom:32px}
  h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}
  .sub{color:var(--soft);font-size:13px}
  .day{text-align:center;margin:26px 0 14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;
       color:var(--ink);background:var(--surface);border:2px solid var(--ink);border-radius:6px;
       padding:3px 10px;display:inline-block;position:relative;left:50%;transform:translateX(-50%)}
  .msg{max-width:78%;margin:8px 0;padding:9px 14px;border-radius:20px;background:var(--raised);
       box-shadow:3px 3px 9px rgba(30,26,23,.10)}
  .msg.mine{margin-left:auto;background:var(--accent);color:#FDF8F2}
  .who{font-size:11px;font-weight:700;opacity:.75;display:flex;gap:8px;align-items:baseline;margin-bottom:2px}
  .who time{font-family:ui-monospace,monospace;font-weight:400;font-size:10px;opacity:.8;margin-left:auto}
  .quote{border-left:3px solid currentColor;opacity:.72;padding:3px 9px;margin:3px 0 6px;font-size:13px}
  .body{word-wrap:break-word;overflow-wrap:anywhere}
  .edited{font-size:11px;opacity:.7;font-style:italic}
  .gone{opacity:.6}
  .file{color:inherit}
  .reactions{margin-top:4px;font-size:13px}
  footer{margin-top:48px;text-align:center;color:var(--faint);font-size:12px;line-height:1.7}
</style>
</head><body><div class="wrap">
<header>
  <h1>${escape(conversation.name)}</h1>
  <div class="sub">${messages.length} messages · exported ${new Date().toLocaleString()}</div>
</header>
${rows.join('\n')}
<footer>
  Exported from Nook. This file is yours — it works offline and needs nothing from us.<br>
  Media is linked, not embedded, so those links only resolve while the server is reachable.
</footer>
</div></body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = conversation.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'conversation';
  a.href = url;
  a.download = `nook-${safeName}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return messages.length;
}
