import React from 'react';
import type { EvidenceRecord, RunBlocker, RunStamp } from '../types';
import { coverageLabel, shortSha } from '../lib/evidence';

export interface EvidenceDocketProps {
  evidence: EvidenceRecord[];
  blockers?: RunBlocker[];
  stamp?: RunStamp;
  /** Compact strip for the composer; full sheet on a round. */
  compact?: boolean;
  emptyHint?: string;
}

const STAMP_LABEL: Record<RunStamp, string> = {
  pending: 'PENDING',
  running: 'IN PROGRESS',
  blocked: 'NOT STAMPED',
  completed: 'STAMPED',
  failed: 'FAILED',
  stopped: 'STOPPED',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="evidence-docket-row">
      <span className="evidence-docket-label">{label}</span>
      <span className="evidence-docket-value">{children}</span>
    </div>
  );
}

export const EvidenceDocket: React.FC<EvidenceDocketProps> = ({
  evidence,
  blockers = [],
  stamp,
  compact = false,
  emptyHint,
}) => {
  if ((!evidence || evidence.length === 0) && blockers.length === 0 && !stamp) {
    if (!emptyHint) return null;
    return (
      <div className="evidence-docket evidence-docket--empty">
        <p className="evidence-docket-empty">{emptyHint}</p>
      </div>
    );
  }

  return (
    <section
      className={`evidence-docket ${compact ? 'evidence-docket--compact' : ''}`}
      aria-label="Evidence docket"
    >
      <header className="evidence-docket-head">
        <div>
          <div className="evidence-docket-kicker">Exhibit docket</div>
          <h4 className="evidence-docket-title">What was actually read</h4>
        </div>
        {stamp && (
          <span className={`evidence-stamp evidence-stamp--${stamp}`} aria-label={`Stamp: ${STAMP_LABEL[stamp]}`}>
            {STAMP_LABEL[stamp]}
          </span>
        )}
      </header>

      {evidence.length === 0 ? (
        <p className="evidence-docket-empty">{emptyHint || 'No exhibits attached.'}</p>
      ) : (
        <ol className="evidence-docket-list">
          {evidence.map((ev, i) => (
            <li key={ev.id} className="evidence-exhibit">
              <div className="evidence-exhibit-index">Exhibit {String.fromCharCode(65 + (i % 26))}</div>
              <Field label="File">{ev.name}</Field>
              <Field label="Size">{ev.byteSize.toLocaleString()} bytes</Field>
              <Field label="Extractor">
                {ev.extractor}
                {ev.extractor === 'failed' ? ' — failed' : ''}
              </Field>
              <Field label="Coverage">{coverageLabel(ev)}</Field>
              <Field label="SHA-256">{shortSha(ev.sha256)}</Field>
              {ev.failDetail && (
                <Field label="Note">
                  <span className="evidence-docket-warn">{ev.failDetail}</span>
                </Field>
              )}
            </li>
          ))}
        </ol>
      )}

      {blockers.length > 0 && (
        <div className="evidence-docket-blockers">
          <div className="evidence-docket-kicker">Open blockers — verdict cannot be stamped</div>
          <ul>
            {blockers.map((b, i) => (
              <li key={`${b.type}-${i}`}>{b.detail}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
