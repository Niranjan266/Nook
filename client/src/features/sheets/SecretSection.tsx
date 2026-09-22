import { useEffect, useState } from 'react';
import type { Conversation } from '@/lib/types';
import { useUi } from '@/stores/ui';
import { safetyNumber, groupDigits } from '@/lib/e2ee/crypto';
import { loadDevice } from '@/lib/e2ee/keystore';
import { markVerified, peerEnd, sessionSummary, boundHere } from '@/lib/e2ee/secret';
import { usePartnerKeyStatus } from '@/lib/e2ee/useSecret';
import { IconLock, IconCheck, IconWarning } from '@/components/Icon';

/**
 * The safety number, and the one switch that records having checked it.
 *
 * Computed from this device's own identity key — read from local storage,
 * not from anything the server sent — and the partner key this chat was
 * actually built on. If anyone swapped a key on the way, the two people's
 * screens show different numbers, which is the whole test.
 */
export default function SecretSection({ conversation, meId }: { conversation: Conversation; meId: string }) {
  const toast = useUi((s) => s.toast);
  const [digits, setDigits] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [here, setHere] = useState<boolean | null>(null);
  const keyStatus = usePartnerKeyStatus(conversation, meId, Boolean(here));
  const first = conversation.name.split(' ')[0];

  useEffect(() => {
    let live = true;
    (async () => {
      const device = await loadDevice().catch(() => null);
      const bound = boundHere(conversation, meId, device?.deviceId || null);
      if (!live) return;
      setHere(bound);
      if (!bound || !device || !conversation.secret) return;
      const summary = await sessionSummary(conversation.id);
      const peer = peerEnd(conversation.secret, meId);
      const number = await safetyNumber(
        { userId: meId, identityPub: device.keys.identity.publicJwk },
        { userId: peer.userId, identityPub: summary?.peerIdentityPub || peer.identityPub }
      );
      if (!live) return;
      setDigits(number);
      setVerified(Boolean(summary?.verified));
    })();
    return () => {
      live = false;
    };
  }, [conversation.id, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sheet-section secret-section">
      <span className="eyebrow row" style={{ gap: 6 }}>
        <IconLock size={13} /> End-to-end encrypted
      </span>

      {here === false && (
        <p className="small muted" style={{ padding: '4px 4px 0' }}>
          This secret chat lives on another of your devices. Its safety number, and its messages, are
          only there.
        </p>
      )}

      {here && (
        <>
          <p className="tiny faint" style={{ padding: '0 4px 6px' }}>
            Compare these numbers with {first}’s — in person, or over a call you trust. If they match,
            nobody is between you. They are the same on both phones.
          </p>

          <div className="safety-number" aria-label="Safety number">
            {digits ? groupDigits(digits).map((g, i) => <span key={i}>{g}</span>) : <span className="muted">Working it out…</span>}
          </div>

          {keyStatus === 'changed' && (
            <p className="small secret-warn-text">
              <IconWarning size={14} /> {first}’s device now publishes a different key than this chat was
              built on. Messages from it will not open here. Start a new secret chat, and check its number.
            </p>
          )}

          <button
            className="list-row"
            disabled={!digits}
            aria-pressed={verified}
            onClick={async () => {
              const next = !verified;
              try {
                await markVerified(conversation.id, next);
                setVerified(next);
                toast(next ? `Marked ${first} as verified` : 'No longer marked as verified');
              } catch {
                toast('Could not save that.', true);
              }
            }}
          >
            <IconCheck size={19} />
            <span className="grow">
              <span className="list-row-label">{verified ? 'Verified' : 'Mark as verified'}</span>
              <span className="list-row-sub">
                {verified ? 'You compared the numbers and they matched' : 'Only once the numbers match'}
              </span>
            </span>
            <span className="toggle" aria-checked={verified} role="switch" />
          </button>
        </>
      )}
    </div>
  );
}
