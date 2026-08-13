export type Accent = 'terracotta' | 'moss' | 'ochre' | 'clay-blue' | 'rust';
export type Visibility = 'everyone' | 'contacts' | 'nobody';

export interface Person {
  id: string;
  username: string;
  /** Short shareable code, e.g. `nook-7f3k2q`. Searchable; can be regenerated. */
  nookId?: string;
  /**
   * What *you* should call this person — already resolved by the server, so
   * rendering `displayName` anywhere is automatically nickname-aware and no
   * call site has to know nicknames exist.
   */
  displayName: string;
  /** Their own name, before your rename. Equal to displayName when unrenamed. */
  realName?: string;
  /** Your private rename, or '' if you haven't set one. */
  nickname?: string;
  avatarUrl: string;
  about?: string;
  accent: Accent;
  online?: boolean;
  lastSeen?: string | null;
  isContact?: boolean;
  quietHours?: PublicQuietHours | null;
}

/**
 * `quietHours` means two different things depending on who is asking: your own
 * full settings, or the redacted window another person is allowed to see. Omit
 * it from Person here so Me can carry the richer shape.
 */
export interface Me extends Omit<Person, 'quietHours'> {
  email: string;
  emailVerified: boolean;
  privacy: { lastSeen: Visibility; readReceipts: boolean; avatar: Visibility };
  settings: {
    theme: 'light' | 'dark' | 'system';
    enterToSend: boolean;
    soundOn: boolean;
    reduceMotion: boolean;
    swipeToReply: boolean;
    linkPreviews: boolean;
    badgeCount: boolean;
    voiceSpeed: number;
    skipSilence: boolean;
  };
  contacts: string[];
  blocked: string[];
  folders: Folder[];
  quietHours: QuietHours;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'file'
  | 'snap'
  | 'system'
  | 'call';

export interface MediaPayload {
  url: string;
  thumbUrl?: string;
  publicId?: string;
  mime?: string;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: number[];
  blurhash?: string;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

export interface QuietHours {
  enabled: boolean;
  start: number;
  end: number;
  timezone: string;
  allowUrgent: boolean;
  visible: boolean;
}

export interface PublicQuietHours {
  window: string;
  start: number;
  end: number;
  quietNow: boolean;
  allowUrgent: boolean;
}

export interface Folder {
  id: string;
  name: string;
  emoji: string;
  conversations: string[];
}

export interface WallObject {
  id: string;
  type: 'note' | 'photo' | 'countdown' | 'link';
  text: string;
  url: string;
  date: string | null;
  x: number;
  y: number;
  by: string | null;
  at: string;
}

export interface WallpaperLook {
  preset?: string;
  url?: string;
  tint?: string;
  dim?: number;
  blur?: number;
}

export interface Space {
  id: string;
  name: string;
  kind: 'personal' | 'business';
  branding: { logoUrl: string; accent: string; wallpaperPreset: string };
  retentionDays: number;
  inviteCode: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  memberCount: number;
}

export interface Message {
  id: string;
  clientId?: string;
  conversationId: string;
  sender: { id: string } & Partial<Person>;
  type: MessageType;
  body: string;
  media: MediaPayload | null;
  replyTo: {
    id: string;
    body?: string;
    type?: MessageType;
    senderId?: string;
    senderName?: string;
    thumbUrl?: string;
  } | null;
  forwarded: boolean;
  mentions: string[];
  reactions: { userId: string; emoji: string }[];
  deliveredTo: string[];
  readBy: string[];
  starred: boolean;
  deletedForAll: boolean;
  deletedForMe: boolean;
  editedAt: string | null;
  viewOnce: {
    enabled: boolean;
    seen: boolean;
    burnt: boolean;
    /** Seconds the viewer gets. 0 = they close it themselves. */
    seconds?: number;
    viewers: string[];
  } | null;
  call: { kind: 'audio' | 'video'; status: string; duration: number } | null;
  expiresAt: string | null;
  createdAt: string;

  transcript: string;
  threadRootId: string | null;
  replyCount: number;
  threadUpdatedAt: string | null;
  editCount: number;
  linkPreview: LinkPreview | null;
  scheduledFor: string | null;

  /** client-only */
  status?: 'pending' | 'failed' | 'sent';
  uploadPct?: number;
}

export interface Pin {
  messageId: string;
  by: string | null;
  at: string;
  message: Message | null;
}

export interface Wallpaper {
  url: string;
  preset: string;
  tint: string;
  dim: number;
  blur: number;
  setBy: string | null;
  proposal: {
    url: string;
    preset: string;
    tint: string;
    dim: number;
    blur: number;
    by: string;
    at: string;
  } | null;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name: string;
  avatarUrl: string;
  description: string;
  inviteCode: string;
  partner: Person | null;
  members: { user: Person | { id: string }; role: 'member' | 'admin'; joinedAt: string }[];
  createdBy: string | null;
  wallpaper: Wallpaper;

  roomState: {
    mood: string;
    note: string;
    by: string | null;
    at: string;
    until: string | null;
  } | null;
  wallpaperHistory: {
    url: string;
    preset: string;
    tint: string;
    dim: number;
    blur: number;
    by: string | null;
    at: string;
  }[];
  wallpaperSchedule: {
    enabled: boolean;
    nightStart: number;
    nightEnd: number;
    day: WallpaperLook | null;
    night: WallpaperLook | null;
  };
  wallObjects: WallObject[];
  pins: Pin[];
  slowMode: number;
  retentionDays: number;
  spaceId: string | null;
  sound: string;

  disappearAfter: number;
  unread: number;
  muted: boolean;
  archived: boolean;
  pinned: boolean;
  locked: boolean;
  draft: string;
  lastReadAt: string | null;
  myRole: 'member' | 'admin';
  lastMessage: Message | null;
  lastActivity: string;
  createdAt: string;
}

export interface CallRecord {
  id: string;
  conversationId: string;
  direction: 'incoming' | 'outgoing';
  kind: 'audio' | 'video';
  status: string;
  duration: number;
  at: string;
  with: Person;
}
