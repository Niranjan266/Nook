import { create } from 'zustand';
import { get as apiGet } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Person } from '@/lib/types';
import { startCallAudio, stopCallAudio, setCallSpeaker } from '@/lib/callaudio';
import { buzz } from '@/lib/native';

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

/**
 * Bumped by every teardown. start() and accept() await three or four things —
 * permission prompts, the ICE fetch, SDP — and a hang-up can land during any
 * of them. Each one captures the value it began with and gives up the moment
 * it changes, instead of carrying on to build a call nobody is on.
 */
let callSeq = 0;

async function iceConfig(): Promise<RTCConfiguration> {
  try {
    const { iceServers } = await apiGet<{ iceServers: RTCIceServer[] }>('/calls/ice');
    return { iceServers };
  } catch {
    return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }
}

/**
 * A two-tone ring, built with the Web Audio API — no asset to load.
 *
 * An incoming ring also buzzes the heartbeat pattern: a call that only plays
 * a tone is easy to miss with the phone in a pocket. Dialling out does not —
 * you are already holding the phone.
 */
function playRing(incoming = false): { stop: () => void } {
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
        g.gain.exponentialRampToValueAtTime(incoming ? 0.24 : 0.12, now + i * 0.22 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.36);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now + i * 0.22);
        osc.stop(now + i * 0.22 + 0.4);
      });
      setTimeout(beat, 2400);
    };
    beat();

    // The heartbeat is ~3.7s long, so it repeats on its own clock, not the tone's.
    let shake: ReturnType<typeof setInterval> | null = null;
    if (incoming) {
      buzz('call');
      shake = setInterval(() => !stopped && buzz('call'), 4600);
    }
    return {
      stop() {
        stopped = true;
        if (shake) clearInterval(shake);
        try {
          navigator.vibrate?.(0); // cut a pattern that is still playing
        } catch {
          /* no Vibration API */
        }
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
  callSeq += 1;
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
    const seq = ++callSeq;
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

    let stream: MediaStream | null = null;
    // Stops the tracks this attempt acquired if it has been hung up meanwhile.
    const abandoned = () => {
      if (seq === callSeq) return false;
      stream?.getTracks().forEach((t) => t.stop());
      return true;
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
      });
      if (abandoned()) return;
      set({ localStream: stream });

      const config = await iceConfig();
      if (abandoned()) return;
      // A local handle: `pc` is shared, and by the time a later await returns
      // it may already belong to the next call.
      const conn = new RTCPeerConnection(config);
      pc = conn;
      stream.getTracks().forEach((t) => conn.addTrack(t, stream!));

      const remote = new MediaStream();
      set({ remoteStream: remote });
      conn.ontrack = (e) => {
        e.streams[0].getTracks().forEach((t) => remote.addTrack(t));
        set({ remoteStream: remote, phase: 'live', startedAt: get().startedAt || Date.now() });
      };

      /**
       * Candidates start arriving as soon as the local description is set,
       * which is before the server has answered with a call id. They used to
       * be dropped, and a call that lost its early candidates often lost the
       * only ones that could connect. Held here, sent once the id is known.
       */
      const early: RTCIceCandidate[] = [];
      conn.onicecandidate = (e) => {
        if (!e.candidate) return;
        const callId = get().callId;
        if (callId) getSocket()?.emit('call:ice', { callId, candidate: e.candidate, to: peer.id });
        else early.push(e.candidate);
      };
      conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'failed' && pc === conn) {
          set({ error: 'Could not connect — you may both be behind strict firewalls.' });
          get().hangUp('failed');
        }
      };

      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      if (abandoned()) return;

      ringtone = playRing();

      getSocket()?.emit(
        'call:offer',
        { conversationId, calleeId: peer.id, kind, sdp: offer },
        (res: { ok: boolean; callId?: string; error?: string }) => {
          // Hung up while the server was still creating the call: it now
          // exists there and is ringing the other phone, so end it.
          if (seq !== callSeq) {
            if (res?.ok && res.callId) getSocket()?.emit('call:end', { callId: res.callId });
            return;
          }
          if (!res?.ok) {
            set({ error: res?.error || 'Could not start the call.' });
            get().hangUp();
          } else {
            set({ callId: res.callId!, phase: 'ringing' });
            early.splice(0).forEach((candidate) =>
              getSocket()?.emit('call:ice', { callId: res.callId, candidate, to: peer.id })
            );
          }
        }
      );
    } catch (err: any) {
      stream?.getTracks().forEach((t) => t.stop());
      if (seq !== callSeq) return;
      set({
        error:
          err?.name === 'NotAllowedError'
            ? 'Microphone or camera permission was refused.'
            : 'No microphone or camera available.',
        phase: 'ended',
      });
      teardown();
      setTimeout(() => set({ phase: 'idle', error: '', localStream: null, remoteStream: null }), 3200);
    }
  },

  receive(payload) {
    if (get().phase !== 'idle') {
      getSocket()?.emit('call:decline', { callId: payload.callId });
      return;
    }
    pendingOffer = payload.sdp;
    ringtone = playRing(true);
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
    const seq = callSeq;
    ringtone?.stop();
    ringtone = null;
    set({ phase: 'connecting' });

    let stream: MediaStream | null = null;
    // Declined, cancelled or ended while this was still setting up.
    const abandoned = () => {
      if (seq === callSeq) return false;
      stream?.getTracks().forEach((t) => t.stop());
      return true;
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video' ? { width: 1280, height: 720, facingMode: 'user' } : false,
      });
      if (abandoned()) return;
      set({ localStream: stream });

      const config = await iceConfig();
      if (abandoned()) return;
      const conn = new RTCPeerConnection(config);
      pc = conn;
      stream.getTracks().forEach((t) => conn.addTrack(t, stream!));

      const remote = new MediaStream();
      set({ remoteStream: remote });
      conn.ontrack = (e) => {
        e.streams[0].getTracks().forEach((t) => remote.addTrack(t));
        set({ remoteStream: remote, phase: 'live', startedAt: get().startedAt || Date.now() });
      };
      conn.onicecandidate = (e) => {
        if (e.candidate && peer) {
          getSocket()?.emit('call:ice', { callId, candidate: e.candidate, to: peer.id });
        }
      };

      await conn.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      if (abandoned()) return;
      for (const c of pendingIce) await conn.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      pendingIce = [];

      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      if (abandoned()) return;
      getSocket()?.emit('call:answer', { callId, sdp: answer });
      set({ startedAt: Date.now() });
    } catch (err: any) {
      if (abandoned()) return;
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

  onEnded({ callId, reason }) {
    // A late end or cancel for an earlier call must not tear down this one.
    if (!callId || callId !== get().callId) return;
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
