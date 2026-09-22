import { useEffect, useState } from 'react';
import type { Conversation } from '@/lib/types';
import { boundHere, myDeviceId, partnerKeyStatus } from './secret';

/**
 * Where a secret chat lives, from a component's point of view.
 *
 * `ready` is false until this device's id has been read from IndexedDB, so a
 * screen never flashes "this chat is on another device" at the person whose
 * device it is on.
 */
export function useSecretPlace(conversation: Conversation | undefined, meId: string) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const secret = conversation?.type === 'secret';

  useEffect(() => {
    if (!secret) return;
    let live = true;
    myDeviceId().then((id) => {
      if (!live) return;
      setDeviceId(id);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [secret, conversation?.id]);

  return {
    secret,
    ready: !secret || ready,
    here: !secret || (ready && boundHere(conversation!, meId, deviceId)),
  };
}

/** Whether the partner's device still has the key this chat was built on. */
export function usePartnerKeyStatus(conversation: Conversation, meId: string, active: boolean) {
  const [status, setStatus] = useState<'ok' | 'changed' | 'gone' | 'unknown'>('unknown');
  useEffect(() => {
    if (!active || conversation.type !== 'secret') return;
    let live = true;
    setStatus('unknown');
    partnerKeyStatus(conversation, meId).then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [active, conversation.id, conversation.type, meId]); // eslint-disable-line react-hooks/exhaustive-deps
  return status;
}
