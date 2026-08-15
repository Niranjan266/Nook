import { create } from 'zustand';
import { get as apiGet } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Person } from '@/lib/types';
import { startCallAudio, stopCallAudio, setCallSpeaker } from '@/lib/callaudio';

type Phase = 'idle' | 'dialing' | 'ringing' | 'connecting' | 'live' | 'ended';

interface CallState {
  phase: Phase;
  callId: string | null;
  conversationId: string | null;
  kind: 'audio' | 'video';
  peer: Person | null;
  outgoing: boolean;
  minimised: boolean;
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
  startedAt: number | null;
  error: string;

  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  start: (opts: { conversationId: string; peer: Person; kind: 'audio' | 'video' }) => Promise<void>;
  receive: (payload: any) => void;
  accept: () => Promise<void>;
  decline: () => void;
  hangUp: (reason?: string) => void;
  toggleMic: () => void;
  toggleCam: () => void;
  toggleSpeaker: () => void;
  setMinimised: (v: boolean) => void;

  /** socket entry points */
  onAnswered: (payload: { callId: string; sdp: any }) => void;
  onIce: (payload: { callId: string; candidate: any }) => void;
  onEnded: (payload: { callId: string; reason: string }) => void;
}

let pc: RTCPeerConnection | null = null;
let pendingOffer: any = null;
let pendingIce: RTCIceCandidateInit[] = [];
let ringtone: { stop: () => void } | null = null;

async function iceConfig(): Promise<RTCConfiguration> {
  try {
    const { iceServers } = await apiGet<{ iceServers: RTCIceServer[] }>('/calls/ice');
    return { iceServers };
  } catch {
    return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }
}

/** A soft two-tone ring, built with the Web Audio API — no asset to load. */
function playRing(): { stop: () => void } {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);

    let stopped = false;
    const beat = () => {
      if (stopped) return;
      const now = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.06, now + i * 0.22 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.36);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now + i * 0.22);
        osc.stop(now + i * 0.22 + 0.4);
      });
      setTimeout(beat, 2400);
    };
    beat();
    return {
      stop() {
        stopped = true;
        setTimeout(() => ctx.close().catch(() => {}), 500);
      },
    };
  } catch {
    return { stop() {} };
  }
}

function teardown() {
  // Every ending goes through here — hang up, decline, missed, failed — which
  // is why the routing is released here and not at each of them. Staying in
  // communication mode after a call leaves music playing out of the earpiece.
  stopCallAudio();
  ringtone?.stop();
  ringtone = null;
  pendingOffer = null;
  pendingIce = [];
  if (pc) {
    pc.getSenders().forEach((s) => s.track?.stop());
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    pc = null;
  }
}

export const useCall = create<CallState>((set, get) => ({
  phase: 'idle',
  callId: null,
  conversationId: null,
  kind: 'audio',
  peer: null,
  outgoing: false,
  minimised: false,
  micOn: true,
  camOn: true,
  /**
   * Off by default: a voice call belongs at your ear.
   *
   * It was `true`, which made every call a speakerphone call — and since the
   * button only flipped this boolean and routed nothing, turning it "off"
   * changed the icon and not the sound. startCallAudio sets the real routing
   * and turns this on by itself for video, where a loudspeaker is right.
   */
  speakerOn: false,
  startedAt: null,
  error: '',
  localStream: null,
  remoteStream: null,

  async start({ conversationId, peer, kind }) {
    if (get().phase !== 'idle') return;
    set({
      phase: 'dialing',
      conversationId,
      peer,
      kind,
      outgoing: true,
      error: '',
      micOn: true,
      camOn: kind === 'video',
      speakerOn: kind === 'video',
      minimised: false,
    });

    // Communication mode, and the output that suits this kind of call.
    startCallAudio(kind === 'video');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
      });
      set({ localStream: stream });

      pc = new RTCPeerConnection(await iceConfig());
      stream.getTracks().forEach((t) => pc!.addTrack(t, stream));

      const remote = new MediaStream();
      set({ remoteStream: remote });
      pc.ontrack = (e) => {
        e.streams[0].getTracks().forEach((t) => remote.addTrack(t));
        set({ remoteStream: remote, phase: 'live', startedAt: get().startedAt || Date.now() });
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && get().callId) {
          getSocket()?.emit('call:ice', {
            callId: get().callId,
            candidate: e.candidate,
            to: peer.id,
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'failed') {
          set({ error: 'Could not connect — you may both be behind strict firewalls.' });
          get().hangUp('failed');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      ringtone = playRing();

      getSocket()?.emit(
        'call:offer',
        { conversationId, calleeId: peer.id, kind, sdp: offer },
        (res: { ok: boolean; callId?: string; error?: string }) => {
          if (!res?.ok) {
            set({ error: res?.error || 'Could not start the call.' });
            get().hangUp();
          } else {
            set({ callId: res.callId!, phase: 'ringing' });
          }
        }
      );
    } catch (err: any) {
      set({
        error:
          err?.name === 'NotAllowedError'
            ? 'Microphone or camera permission was refused.'
            : 'No microphone or camera available.',
        phase: 'ended',
      });
      teardown();
      setTimeout(() => set({ phase: 'idle', error: '' }), 3200);
    }
  },

  receive(payload) {
    if (get().phase !== 'idle') {
      getSocket()?.emit('call:decline', { callId: payload.callId });
      return;
    }
    pendingOffer = payload.sdp;
    ringtone = playRing();
    set({
      phase: 'ringing',
      callId: payload.callId,
      conversationId: payload.conversationId,
      kind: payload.kind,
      peer: payload.from,
      outgoing: false,
      minimised: false,
      micOn: true,
      camOn: payload.kind === 'video',
      speakerOn: payload.kind === 'video',
      error: '',
    });
  },

  async accept() {
    const { kind, peer, callId } = get();
    ringtone?.stop();
    ringtone = null;
    set({ phase: 'connecting' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
      });
      set({ localStream: stream });

      pc = new RTCPeerConnection(await iceConfig());
      stream.getTracks().forEach((t) => pc!.addTrack(t, stream));

      const remote = new MediaStream();
      set({ remoteStream: remote });
      pc.ontrack = (e) => {
        e.streams[0].getTracks().forEach((t) => remote.addTrack(t));
        set({ remoteStream: remote, phase: 'live', startedAt: get().startedAt || Date.now() });
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && peer) {
          getSocket()?.emit('call:ice', { callId, candidate: e.candidate, to: peer.id });
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      for (const c of pendingIce) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      pendingIce = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      getSocket()?.emit('call:answer', { callId, sdp: answer });
      set({ startedAt: Date.now() });
    } catch (err: any) {
      set({
        error:
          err?.name === 'NotAllowedError'
            ? 'Microphone or camera permission was refused.'
            : 'No microphone or camera available.',
      });
      get().hangUp();
    }
  },

  decline() {
    const { callId } = get();
    if (callId) getSocket()?.emit('call:decline', { callId });
    teardown();
    set({ phase: 'idle', callId: null, peer: null, localStream: null, remoteStream: null, startedAt: null });
  },

  hangUp() {
    const { callId, localStream } = get();
    if (callId) getSocket()?.emit('call:end', { callId });
    localStream?.getTracks().forEach((t) => t.stop());
    teardown();
    set({ phase: 'ended' });
    setTimeout(
      () =>
        set({
          phase: 'idle',
          callId: null,
          peer: null,
          localStream: null,
          remoteStream: null,
          startedAt: null,
          minimised: false,
          error: '',
        }),
      900
    );
  },

  toggleMic() {
    const { localStream, micOn } = get();
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !micOn));
    set({ micOn: !micOn });
  },

  toggleCam() {
    const { localStream, camOn } = get();
    localStream?.getVideoTracks().forEach((t) => (t.enabled = !camOn));
    set({ camOn: !camOn });
  },

  toggleSpeaker: () => {
    const on = !get().speakerOn;
    // Route first, then reflect it. The button showing "speaker on" while the
    // sound stays at the earpiece is the bug this replaces.
    setCallSpeaker(on);
    set({ speakerOn: on });
  },
  setMinimised: (minimised) => set({ minimised }),

  async onAnswered({ callId, sdp }) {
    if (get().callId !== callId || !pc) return;
    ringtone?.stop();
    ringtone = null;
    set({ phase: 'connecting' });
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const c of pendingIce) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    pendingIce = [];
    set({ startedAt: Date.now() });
  },

  async onIce({ callId, candidate }) {
    if (get().callId !== callId) return;
    if (!pc || !pc.remoteDescription) {
      pendingIce.push(candidate);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  },

  onEnded({ reason }) {
    const { localStream } = get();
    localStream?.getTracks().forEach((t) => t.stop());
    teardown();
    set({
      phase: 'ended',
      error:
        reason === 'declined' ? 'Call declined' : reason === 'missed' ? 'No answer' : '',
    });
    setTimeout(
      () =>
        set({
          phase: 'idle',
          callId: null,
          peer: null,
          localStream: null,
          remoteStream: null,
          startedAt: null,
          minimised: false,
          error: '',
        }),
      1400
    );
  },
}));
