/**
 * Hand-rolled icon set. Round caps, 1.9 stroke, slightly soft geometry so the
 * icons sit next to clay rather than fighting it. No icon-font dependency.
 */
import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

const Svg = ({ size = 20, children, ...rest }: Props) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const IconChat = (p: Props) => (
  <Svg {...p}>
    <path d="M20.5 11.7c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.2-2.9-.4L4 20.5l1.4-3.6A7 7 0 0 1 3.5 11.7C3.5 7.6 7.3 4.3 12 4.3s8.5 3.3 8.5 7.4Z" />
  </Svg>
);

export const IconPhone = (p: Props) => (
  <Svg {...p}>
    <path d="M6.3 3.8h2.9l1.5 3.7-1.9 1.4a11.6 11.6 0 0 0 5.3 5.3l1.4-1.9 3.7 1.5v2.9c0 1.2-1 2.2-2.2 2.1C10.2 18.3 5.7 13.8 4.2 6c-.1-1.2.9-2.2 2.1-2.2Z" />
  </Svg>
);

export const IconVideo = (p: Props) => (
  <Svg {...p}>
    <rect x="2.8" y="6" width="12.5" height="12" rx="3.4" />
    <path d="M15.3 11.2 20 8.3c.6-.4 1.3 0 1.3.7v6c0 .7-.7 1.1-1.3.7l-4.7-2.9Z" />
  </Svg>
);

export const IconSend = (p: Props) => (
  <Svg {...p}>
    <path d="M4.6 12 20 4.5 15.5 20l-4-6.2L4.6 12Z" />
    <path d="m11.5 13.8 8.5-9.3" />
  </Svg>
);

export const IconPlus = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Svg>
);

export const IconClose = (p: Props) => (
  <Svg {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const IconBack = (p: Props) => (
  <Svg {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);

export const IconSearch = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.3" />
    <path d="m16 16 4 4" />
  </Svg>
);

export const IconMenu = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h11" />
  </Svg>
);

export const IconMore = (p: Props) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconReply = (p: Props) => (
  <Svg {...p}>
    <path d="M9 7.5 4.5 12 9 16.5" />
    <path d="M4.5 12h8.8a5.7 5.7 0 0 1 5.7 5.7v1.3" />
  </Svg>
);

export const IconForward = (p: Props) => (
  <Svg {...p}>
    <path d="m15 7.5 4.5 4.5L15 16.5" />
    <path d="M19.5 12h-8.8A5.7 5.7 0 0 0 5 17.7V19" />
  </Svg>
);

export const IconStar = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4.4l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.7L12 4.4Z" />
  </Svg>
);

export const IconStarFill = (p: Props) => (
  <Svg {...p} fill="currentColor">
    <path d="M12 4.4l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.7L12 4.4Z" />
  </Svg>
);

export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M4.8 7h14.4M9.5 7V5.4c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1V7" />
    <path d="M6.6 7.2 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.8-11.8" />
  </Svg>
);

export const IconEdit = (p: Props) => (
  <Svg {...p}>
    <path d="M15.8 4.9a2.1 2.1 0 0 1 3 3L9.4 17.3l-4 1 1-4L15.8 5Z" />
  </Svg>
);

export const IconEmoji = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M8.8 14.2a4 4 0 0 0 6.4 0" />
    <circle cx="9.3" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.7" cy="10" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPaperclip = (p: Props) => (
  <Svg {...p}>
    <path d="M17.5 9.5 10.8 16a3.4 3.4 0 0 1-4.8-4.8l7.6-7.6a2.3 2.3 0 0 1 3.2 3.2l-7.5 7.5a1.1 1.1 0 0 1-1.6-1.6l6.7-6.7" />
  </Svg>
);

export const IconImage = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="4.8" width="17" height="14.4" rx="3.4" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m4.5 17 4.2-4a2 2 0 0 1 2.8 0l4 3.8m1.2-1.2 1-.9a2 2 0 0 1 2.7 0l1 .9" />
  </Svg>
);

export const IconCamera = (p: Props) => (
  <Svg {...p}>
    <path d="M4.8 8.2h2.4l1.1-2h7.4l1.1 2h2.4a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H4.8a2 2 0 0 1-2-2v-7.2a2 2 0 0 1 2-2Z" />
    <circle cx="12" cy="13.6" r="3.3" />
  </Svg>
);

export const IconFile = (p: Props) => (
  <Svg {...p}>
    <path d="M13.4 3.5H7.6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2V8.5l-5-5Z" />
    <path d="M13.4 3.5v5h5" />
  </Svg>
);

export const IconMic = (p: Props) => (
  <Svg {...p}>
    <rect x="9.2" y="3.2" width="5.6" height="10.4" rx="2.8" />
    <path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6v3.2" />
  </Svg>
);

export const IconMicOff = (p: Props) => (
  <Svg {...p}>
    <path d="M9.2 6v-.2a2.8 2.8 0 0 1 5.6 0v5.4m-5.6-.5v.9a2.8 2.8 0 0 0 4 2.5" />
    <path d="M5.8 11.4a6.2 6.2 0 0 0 9.6 5.2M18.2 11.4v.3M12 17.6v3.2" />
    <path d="m4 4 16 16" />
  </Svg>
);

export const IconVideoOff = (p: Props) => (
  <Svg {...p}>
    <path d="M15.3 11.2 20 8.3c.6-.4 1.3 0 1.3.7v6c0 .5-.4.9-.9.9" />
    <path d="M13.6 6h-8A2.8 2.8 0 0 0 2.8 8.8v6.4A2.8 2.8 0 0 0 5.6 18h8a2.8 2.8 0 0 0 1.7-.6" />
    <path d="m4 4 16 16" />
  </Svg>
);

export const IconHangUp = (p: Props) => (
  <Svg {...p}>
    <path d="M3.4 13.4c4.7-4.6 12.5-4.6 17.2 0 .6.6.6 1.6 0 2.2l-1.6 1.6a1.5 1.5 0 0 1-2 .1l-1.6-1.4a1.5 1.5 0 0 1-.5-1.4l.2-1.1a9.6 9.6 0 0 0-6.2 0l.2 1.1c.1.5-.1 1-.5 1.4l-1.6 1.4c-.6.5-1.5.5-2-.1l-1.6-1.6a1.5 1.5 0 0 1 0-2.2Z" />
  </Svg>
);

export const IconSpeaker = (p: Props) => (
  <Svg {...p}>
    <path d="M4 9.5h3l4-3.4v11.8l-4-3.4H4a.9.9 0 0 1-.9-.9v-3.2c0-.5.4-.9.9-.9Z" />
    <path d="M14.8 9.4a3.6 3.6 0 0 1 0 5.2M17.3 7a7 7 0 0 1 0 10" />
  </Svg>
);

export const IconBell = (p: Props) => (
  <Svg {...p}>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4.2 1.4 5.5 1.4 5.5H5.1S6.5 14.2 6.5 10Z" />
    <path d="M10.2 18.5a2 2 0 0 0 3.6 0" />
  </Svg>
);

export const IconBellOff = (p: Props) => (
  <Svg {...p}>
    <path d="M8.3 5.6A5.5 5.5 0 0 1 17.5 10c0 2 .3 3.4.7 4.3M6.6 9.3c0 .2-.1.5-.1.7 0 4.2-1.4 5.5-1.4 5.5h11" />
    <path d="M10.2 18.5a2 2 0 0 0 3.6 0M4 4l16 16" />
  </Svg>
);

export const IconPin = (p: Props) => (
  <Svg {...p}>
    <path d="M9.5 3.8h5l-.7 5 3 2.6v1.4H7.2v-1.4l3-2.6-.7-5ZM12 12.8v7.4" />
  </Svg>
);

export const IconArchive = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1.6" />
    <path d="M5.2 8.5v9.4a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8.5M10 12.3h4" />
  </Svg>
);

export const IconClock = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.6V12l3 1.8" />
  </Svg>
);

export const IconFire = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.2s.9 3-1.4 5.2c-2.3 2.2-3.6 3.6-3.6 6.1a5 5 0 0 0 10 0c0-2.6-1.7-4-2.7-5.6-.5 1-1.2 1.6-2 1.9.4-2.9-.3-5.6-.3-7.6Z" />
  </Svg>
);

export const IconLock = (p: Props) => (
  <Svg {...p}>
    <rect x="4.8" y="10.2" width="14.4" height="10" rx="2.6" />
    <path d="M8.2 10.2V7.8a3.8 3.8 0 0 1 7.6 0v2.4" />
  </Svg>
);

export const IconUsers = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.4" />
    <path d="M3.2 19.2a5.9 5.9 0 0 1 11.6 0" />
    <path d="M16 5.6a3.4 3.4 0 0 1 0 6.6M17.4 14.4a5.9 5.9 0 0 1 3.4 4.8" />
  </Svg>
);

export const IconUser = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="8.2" r="3.8" />
    <path d="M4.8 19.6a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
);

export const IconSettings = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
  </Svg>
);

export const IconWallpaper = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3.4" />
    <path d="M3.5 15.4 8 11a2 2 0 0 1 2.8 0l4.3 4.3M14.6 13.6l1.6-1.5a2 2 0 0 1 2.8 0l1.5 1.4" />
    <circle cx="9" cy="9.2" r="1.4" />
  </Svg>
);

export const IconMoon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
  </Svg>
);

export const IconSun = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.8v1.8M12 19.4v1.8M21.2 12h-1.8M4.6 12H2.8M18.5 5.5l-1.3 1.3M6.8 17.2l-1.3 1.3M18.5 18.5l-1.3-1.3M6.8 6.8 5.5 5.5" />
  </Svg>
);

export const IconLogOut = (p: Props) => (
  <Svg {...p}>
    <path d="M14 7.5V5.9a2 2 0 0 0-2-2H6.4a2 2 0 0 0-2 2v12.2a2 2 0 0 0 2 2H12a2 2 0 0 0 2-2v-1.6" />
    <path d="M9.8 12h10.4m0 0-2.9-2.9M20.2 12l-2.9 2.9" />
  </Svg>
);

export const IconCheck = (p: Props) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const IconTick = ({ size = 16, ...p }: Props) => (
  <svg width={size} height={size * 0.7} viewBox="0 0 22 15" fill="none" aria-hidden="true" {...p}>
    <path
      d="M1.6 8.2 5 11.6 12 4"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconTickDouble = ({ size = 16, ...p }: Props) => (
  <svg width={size} height={size * 0.7} viewBox="0 0 22 15" fill="none" aria-hidden="true" {...p}>
    <path
      d="M1.4 8.2 4.6 11.4 11 4M9 11.4 15.4 4"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconClockSmall = ({ size = 13, ...p }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
    <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M12 7.8V12l2.8 1.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const IconWarning = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4.4 21 19.6H3L12 4.4Z" />
    <path d="M12 10v3.6M12 16.6v.1" />
  </Svg>
);

export const IconDown = (p: Props) => (
  <Svg {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </Svg>
);

export const IconPlay = (p: Props) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M8 5.4 19 12 8 18.6V5.4Z" />
  </Svg>
);

export const IconPause = (p: Props) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
  </Svg>
);

export const IconDownload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v11m0 0-4-4m4 4 4-4M4.5 19.5h15" />
  </Svg>
);

export const IconBlock = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="m6.2 6.2 11.6 11.6" />
  </Svg>
);

export const IconCallIn = (p: Props) => (
  <Svg {...p}>
    <path d="M6.3 3.8h2.9l1.5 3.7-1.9 1.4a11.6 11.6 0 0 0 5.3 5.3l1.4-1.9 3.7 1.5v2.9c0 1.2-1 2.2-2.2 2.1C10.2 18.3 5.7 13.8 4.2 6c-.1-1.2.9-2.2 2.1-2.2Z" />
    <path d="M20 4.5 15 9.5m0 0h3.6M15 9.5V6" />
  </Svg>
);

export const IconThread = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 8.4A3.4 3.4 0 0 1 7.9 5h8.2a3.4 3.4 0 0 1 3.4 3.4v3.4a3.4 3.4 0 0 1-3.4 3.4H10l-4 3v-3h-.1a1.4 1.4 0 0 1-1.4-1.4Z" />
    <path d="M8.6 9.8h6.8M8.6 12.6h4" />
  </Svg>
);

export const IconMoon2 = (p: Props) => (
  <Svg {...p}>
    <path d="M19.5 14.4A7.8 7.8 0 0 1 9.6 4.5a7.8 7.8 0 1 0 9.9 9.9Z" />
    <path d="M16.5 3.5v3M15 5h3" />
  </Svg>
);

export const IconWall = (p: Props) => (
  <Svg {...p}>
    <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6" />
    <path d="M3.4 9.6h17.2M8.6 9.6v9.8M14.4 4.6v5M14.4 14.5v4.9M8.6 14.5h12" />
  </Svg>
);

export const IconSchedule = (p: Props) => (
  <Svg {...p}>
    <rect x="3.6" y="5.4" width="16.8" height="14.2" rx="2.8" />
    <path d="M3.6 10h16.8M8.4 3.4v3.4M15.6 3.4v3.4" />
    <path d="M12 12.6v2.6l1.8 1.1" />
  </Svg>
);

export const IconFolder = (p: Props) => (
  <Svg {...p}>
    <path d="M3.6 7.4a2 2 0 0 1 2-2h3.1l1.9 2.2h6.8a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z" />
  </Svg>
);

export const IconHistory = (p: Props) => (
  <Svg {...p}>
    <path d="M3.8 12a8.2 8.2 0 1 0 2.6-6" />
    <path d="M3.6 4.2v3.9h3.9M12 7.8V12l2.8 1.7" />
  </Svg>
);

export const IconCallOut = (p: Props) => (
  <Svg {...p}>
    <path d="M6.3 3.8h2.9l1.5 3.7-1.9 1.4a11.6 11.6 0 0 0 5.3 5.3l1.4-1.9 3.7 1.5v2.9c0 1.2-1 2.2-2.2 2.1C10.2 18.3 5.7 13.8 4.2 6c-.1-1.2.9-2.2 2.1-2.2Z" />
    <path d="M15 9.5 20 4.5m0 0h-3.6M20 4.5V8" />
  </Svg>
);
