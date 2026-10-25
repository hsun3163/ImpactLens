'use client';

import { useState } from 'react';
import { smsRequest } from './SmsDashboard';

/** Explicit administrator action; never runs merely because a page is viewed. */
export default function CenterCollectionSetup({ onSaved }: { onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function populate(defy = false) {
    if (busy) return;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      await smsRequest(defy ? '/api/sms/defy-activity' : '/api/sms/center-collection', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:defy ? 'populate-defy' : 'populate-centers'})});
      setMessage(defy ? 'Defy program activity saved. Existing check-ins are unchanged.' : 'Center collection saved. Existing check-ins are unchanged.'); onSaved();
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Unable to save the center collection.'); }
    finally { setBusy(false); }
  }
  return <details className="sms-panel" style={{marginBottom:24,padding:20}}><summary style={{cursor:'pointer',minHeight:44,paddingTop:10}}>Center collection</summary><p>Load four centers, their programs and activity history. Repeating this action does not duplicate records. Existing SMS check-ins and permissions stay unchanged.</p><button type="button" className="sms-button sms-secondary" onClick={() => populate()} disabled={busy}>{busy ? 'Saving centers…' : 'Load center collection'}</button><button type="button" className="sms-button sms-secondary" onClick={() => populate(true)} disabled={busy}>Load Defy program activity</button>{message && <p role={failed ? 'alert' : 'status'}>{message}</p>}</details>;
}
