interface ChangelogModalProps {
  version: string;
  changelog: string;
  onDismiss: () => void;
}

function renderChangelog(text: string) {
  return text.split('\n').map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={i} />;
    if (trimmed.startsWith('# ')) return <h3 key={i} className="changelog-heading">{trimmed.slice(2)}</h3>;
    if (trimmed.startsWith('## ')) return <h4 key={i} className="changelog-subheading">{trimmed.slice(3)}</h4>;
    if (trimmed.startsWith('- ')) return <li key={i} className="changelog-item">{trimmed.slice(2)}</li>;
    return <p key={i} className="changelog-text">{trimmed}</p>;
  });
}

export function ChangelogModal({ version, changelog, onDismiss }: ChangelogModalProps) {
  return (
    <div className="settings-overlay" onClick={onDismiss}>
      <div className="settings-modal changelog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>What's New in v{version}</h2>
          <button className="close-btn" onClick={onDismiss}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="changelog-content">
          <ul className="changelog-list">
            {renderChangelog(changelog)}
          </ul>
        </div>

        <div className="changelog-footer">
          <button className="btn btn-primary" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
