import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCall } from '@/stores/call';
import Avatar from '@/components/Avatar';
import { duration } from '@/lib/format';
import { spring } from '@/lib/motion';
import {
  IconMic,
  IconMicOff,
  IconVideo,
  IconVideoOff,
  IconHangUp,
  IconSpeaker,
  IconDown,
  IconPhone,
} from '@/components/Icon';

export default function CallOverlay() {
  const call = useCall();
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (remoteVideo.current && call.remoteStream) remoteVideo.current.srcObject = call.remoteStream;
    if (remoteAudio.current && call.remoteStream) remoteAudio.current.srcObject = call.remoteStream;
  }, [call.remoteStream]);

  useEffect(() => {
    if (localVideo.current && call.localStream) localVideo.current.srcObject = call.localStream;
  }, [call.localStream, call.minimised, call.phase]);

  useEffect(() => {
    if (call.phase !== 'live' || !call.startedAt) return setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - call.startedAt!) / 1000)), 500);
    return () => clearInterval(t);
  }, [call.phase, call.startedAt]);

  if (call.phase === 'idle') return null;

  const incoming = !call.outgoing && call.phase === 'ringing';
  const isVideo = call.kind === 'video';

  const stateLabel =
    call.error ||
    (call.phase === 'dialing'
      ? 'Starting…'
      : call.phase === 'ringing'
        ? call.outgoing
          ? 'Ringing…'
          : `Incoming ${isVideo ? 'video' : 'voice'} call`
        : call.phase === 'connecting'
          ? 'Connecting…'
          : call.phase === 'ended'
            ? 'Call ended'
            : '');

  /* ── minimised pill ───────────────────────────────────────────────────── */
  if (call.minimised && call.phase === 'live') {
    return (
      <>
        <audio ref={remoteAudio} autoPlay playsInline />
        <motion.div
          className="call-pill"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={spring}
          onClick={() => call.setMinimised(false)}
          role="button"
          tabIndex={0}
        >
          <Avatar name={call.peer?.displayName || ''} src={call.peer?.avatarUrl} id={call.peer?.id} size={30} />
          <span className="stack" style={{ gap: 0 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              {call.peer?.displayName}
            </span>
            <span className="call-timer tabular tiny">{duration(elapsed)}</span>
          </span>
          <button
            className="hang-sm"
            onClick={(e) => {
              e.stopPropagation();
              call.hangUp();
            }}
            aria-label="End call"
          >
            <IconHangUp size={17} />
          </button>
        </motion.div>
      </>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        className="call"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={spring}
        role="dialog"
        aria-label="Call"
      >
        <audio ref={remoteAudio} autoPlay playsInline muted={isVideo} />

        <header className="call-head">
          {call.phase === 'live' && (
            <button className="clay-round" onClick={() => call.setMinimised(true)} aria-label="Minimise call">
              <IconDown />
            </button>
          )}
          <span className="grow stack" style={{ gap: 0 }}>
            <span className="call-state">{stateLabel}</span>
            {call.phase === 'live' && <span className="call-timer">{duration(elapsed)}</span>}
          </span>
        </header>

        <div className="call-stage">
          {isVideo && call.phase === 'live' ? (
            <div className="call-video">
              <video ref={remoteVideo} autoPlay playsInline />
              <div className="call-self">
                {call.camOn ? (
                  <video ref={localVideo} autoPlay playsInline muted />
                ) : (
                  <div className="call-video-off">
                    <Avatar name="You" size={44} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={`call-orb${call.phase === 'ringing' ? ' ringing' : ''}`}>
              <Avatar
                name={call.peer?.displayName || '?'}
                src={call.peer?.avatarUrl}
                id={call.peer?.id}
                accent={call.peer?.accent}
                size={168}
              />
              <span className="call-name">{call.peer?.displayName}</span>
              {call.peer?.username && <span className="muted small">@{call.peer.username}</span>}
            </div>
          )}
        </div>

        {call.phase === 'live' && (
          <p className="call-warning">
            Peer-to-peer. If this fails to connect, one of you is likely behind a strict firewall — a TURN
            server fixes it.
          </p>
        )}

        <div className="call-controls">
          {incoming ? (
            <>
              <button className="call-btn hang" onClick={call.decline} aria-label="Decline">
                <IconHangUp size={26} />
              </button>
              <button className="call-btn accept" onClick={call.accept} aria-label="Accept">
                <IconPhone size={26} />
              </button>
            </>
          ) : (
            <>
              <button
                className={`call-btn${call.micOn ? '' : ' off'}`}
                onClick={call.toggleMic}
                aria-label={call.micOn ? 'Mute' : 'Unmute'}
                aria-pressed={!call.micOn}
              >
                {call.micOn ? <IconMic size={22} /> : <IconMicOff size={22} />}
              </button>

              {isVideo && (
                <button
                  className={`call-btn${call.camOn ? '' : ' off'}`}
                  onClick={call.toggleCam}
                  aria-label={call.camOn ? 'Turn camera off' : 'Turn camera on'}
                  aria-pressed={!call.camOn}
                >
                  {call.camOn ? <IconVideo size={22} /> : <IconVideoOff size={22} />}
                </button>
              )}

              <button className="call-btn hang" onClick={() => call.hangUp()} aria-label="End call">
                <IconHangUp size={26} />
              </button>

              <button
                className={`call-btn${call.speakerOn ? '' : ' off'}`}
                onClick={call.toggleSpeaker}
                aria-label="Speaker"
                aria-pressed={call.speakerOn}
              >
                <IconSpeaker size={22} />
              </button>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
