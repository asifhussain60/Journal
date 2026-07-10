export function SaveBar({
  dirty,
  saving,
  locked,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  locked: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {locked && (
        <span
          className="rounded-md border border-warning/40 px-2 py-1 text-[0.68rem] text-warning"
          title="This chapter is marked locked. Your edit becomes the new locked version when saved."
        >
          🔒 Locked
        </span>
      )}
      <span className="text-xs text-text-muted">
        {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
      </span>
      <button
        onClick={onSave}
        disabled={saving || !dirty}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast disabled:opacity-40"
      >
        Save to git
      </button>
    </div>
  );
}
