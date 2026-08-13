/**
 * One shared shape for conversations and messages, used by both REST routes and
 * socket emits. If the client only ever sees one shape, the stores stay simple.
 *
 * This file is deliberately unchanged in output by the move from MongoDB to
 * libSQL — the database underneath is completely different, the JSON the client
 * receives is byte-for-byte the same.
 */

const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);

export function serializeUser(u) {
  if (!u) return null;
  return {
    id: String(u._id || u.id),
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl || '',
    about: u.about || '',
    accent: u.accent || 'terracotta',
    online: Boolean(u.online),
    lastSeen: iso(u.lastSeen),
  };
}

export function serializeMessage(m, viewerId) {
  if (!m) return null;
  const id = String(m._id || m.id);
  const viewer = String(viewerId || '');
  const deletedForMe = (m.deletedFor || []).some((u) => String(u) === viewer);

  const viewOnce = m.viewOnce || {};
  const seenByViewer = (viewOnce.viewedBy || []).some((u) => String(u) === viewer);
  const senderId = String(m.sender?._id || m.sender?.id || m.sender);
  const isMine = senderId === viewer;
  const burnt = viewOnce.enabled && !isMine && seenByViewer;

  return {
    id,
    clientId: m.clientId || '',
    conversationId: String(m.conversation?._id || m.conversation),
    sender: m.sender?.username ? serializeUser(m.sender) : { id: senderId },
    type: m.type,
    body: m.deletedForAll || deletedForMe ? '' : m.body || '',
    media:
      m.deletedForAll || deletedForMe || burnt
        ? null
        : m.media?.url
          ? {
              url: m.media.url,
              thumbUrl: m.media.thumbUrl || '',
              mime: m.media.mime || '',
              name: m.media.name || '',
              size: m.media.size || 0,
              width: m.media.width || 0,
              height: m.media.height || 0,
              duration: m.media.duration || 0,
              waveform: m.media.waveform || [],
              blurhash: m.media.blurhash || '',
            }
          : null,
    transcript: m.transcript || '',
    threadRootId: m.threadRoot ? String(m.threadRoot._id || m.threadRoot) : null,
    replyCount: m.replyCount || 0,
    threadUpdatedAt: iso(m.threadUpdatedAt),
    editCount: (m.edits || []).length,
    linkPreview: m.linkPreview?.url
      ? {
          url: m.linkPreview.url,
          title: m.linkPreview.title || '',
          description: m.linkPreview.description || '',
          image: m.linkPreview.image || '',
          siteName: m.linkPreview.siteName || '',
        }
      : null,
    scheduledFor: m.delivered === false ? iso(m.scheduledFor) : null,
    replyTo: m.replyTo
      ? typeof m.replyTo === 'object' && m.replyTo.body !== undefined
        ? {
            id: String(m.replyTo._id),
            body: m.replyTo.deletedForAll ? '' : m.replyTo.body,
            type: m.replyTo.type,
            senderId: String(m.replyTo.sender?._id || m.replyTo.sender),
            senderName: m.replyTo.sender?.displayName || '',
            thumbUrl: m.replyTo.media?.thumbUrl || m.replyTo.media?.url || '',
          }
        : { id: String(m.replyTo) }
      : null,
    forwarded: Boolean(m.forwardedFrom),
    mentions: (m.mentions || []).map(String),
    reactions: (m.reactions || []).map((r) => ({ userId: String(r.user), emoji: r.emoji })),
    deliveredTo: (m.deliveredTo || []).map((d) => String(d.user)),
    readBy: (m.readBy || []).map((r) => String(r.user)),
    starred: (m.starredBy || []).some((u) => String(u) === viewer),
    deletedForAll: Boolean(m.deletedForAll),
    deletedForMe,
    editedAt: iso(m.editedAt),
    viewOnce: viewOnce.enabled
      ? { enabled: true, seen: seenByViewer, burnt, viewers: (viewOnce.viewedBy || []).map(String) }
      : null,
    call: m.call?.kind ? { kind: m.call.kind, status: m.call.status, duration: m.call.duration || 0 } : null,
    expiresAt: iso(m.expiresAt),
    createdAt: iso(m.createdAt),
  };
}

export function serializeConversation(c, viewerId) {
  if (!c) return null;
  const viewer = String(viewerId || '');
  const mine = (c.members || []).find((m) => String(m.user?._id || m.user?.id || m.user) === viewer);
  const others = (c.members || []).filter((m) => String(m.user?._id || m.user?.id || m.user) !== viewer);
  const partner = c.type === 'direct' ? others[0]?.user : null;

  return {
    id: String(c._id || c.id),
    type: c.type,
    name: c.type === 'group' ? c.name : partner?.displayName || 'Someone',
    avatarUrl: c.type === 'group' ? c.avatarUrl || '' : partner?.avatarUrl || '',
    description: c.description || '',
    inviteCode: c.inviteCode || '',
    partner: partner?.username ? serializeUser(partner) : null,
    members: (c.members || []).map((m) => ({
      user: m.user?.username ? serializeUser(m.user) : { id: String(m.user) },
      role: m.role,
      joinedAt: iso(m.joinedAt),
    })),
    createdBy: c.createdBy ? String(c.createdBy) : null,

    wallpaper: {
      url: c.wallpaper?.url || '',
      preset: c.wallpaper?.preset || '',
      tint: c.wallpaper?.tint || '',
      dim: c.wallpaper?.dim ?? 0.35,
      blur: c.wallpaper?.blur ?? 0,
      setBy: c.wallpaper?.setBy ? String(c.wallpaper.setBy) : null,
      proposal: c.wallpaper?.proposal?.by
        ? {
            url: c.wallpaper.proposal.url,
            preset: c.wallpaper.proposal.preset,
            tint: c.wallpaper.proposal.tint,
            dim: c.wallpaper.proposal.dim,
            blur: c.wallpaper.proposal.blur,
            by: String(c.wallpaper.proposal.by),
            at: iso(c.wallpaper.proposal.at),
          }
        : null,
    },

    roomState:
      c.roomState?.mood || c.roomState?.note
        ? {
            mood: c.roomState.mood || '',
            note: c.roomState.note || '',
            by: c.roomState.by ? String(c.roomState.by) : null,
            at: iso(c.roomState.at),
            until: iso(c.roomState.until),
          }
        : null,

    wallpaperHistory: (c.wallpaperHistory || []).slice(-24).map((w) => ({
      url: w.url || '',
      preset: w.preset || '',
      tint: w.tint || '',
      dim: w.dim ?? 0.35,
      blur: w.blur ?? 0,
      by: w.by ? String(w.by) : null,
      at: iso(w.at),
    })),

    wallpaperSchedule: {
      enabled: Boolean(c.wallpaperSchedule?.enabled),
      nightStart: c.wallpaperSchedule?.nightStart ?? 19 * 60,
      nightEnd: c.wallpaperSchedule?.nightEnd ?? 7 * 60,
      day: c.wallpaperSchedule?.day || null,
      night: c.wallpaperSchedule?.night || null,
    },

    wallObjects: (c.wallObjects || []).map((o) => ({
      id: o.id,
      type: o.type,
      text: o.text || '',
      url: o.url || '',
      date: iso(o.date),
      x: o.x ?? 50,
      y: o.y ?? 50,
      by: o.by ? String(o.by) : null,
      at: iso(o.at),
    })),

    pins: (c.pins || []).map((p) => ({
      messageId: String(p.message?._id || p.message),
      by: p.by ? String(p.by) : null,
      at: iso(p.at),
      message:
        p.message && typeof p.message === 'object' && p.message.type
          ? serializeMessage(p.message, viewer)
          : null,
    })),

    slowMode: c.slowMode || 0,
    retentionDays: c.retentionDays || 0,
    spaceId: c.space ? String(c.space._id || c.space) : null,
    sound: mine?.sound || 'default',

    disappearAfter: c.disappearAfter || 0,
    unread: mine?.unread || 0,
    muted: Boolean(mine?.muted),
    archived: Boolean(mine?.archived),
    pinned: Boolean(mine?.pinned),
    locked: Boolean(mine?.locked),
    draft: mine?.draft || '',
    lastReadAt: iso(mine?.lastReadAt),
    myRole: mine?.role || 'member',
    lastMessage: c.lastMessage && typeof c.lastMessage === 'object' && c.lastMessage.type
      ? serializeMessage(c.lastMessage, viewer)
      : null,
    lastActivity: iso(c.lastActivity || c.updatedAt),
    createdAt: iso(c.createdAt),
  };
}
