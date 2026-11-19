import { useState } from "react";

import { showToast } from "@/lib/toast";

const PREVIEW_LIMIT = 4;

export type ClassFileListItem = {
  file: string;
  count?: number;
};

type ClassFileListProps = {
  files: ClassFileListItem[];
  /** When true, append `(count)` after each filename. */
  showCounts?: boolean;
  emptyLabel?: string;
  /** Visual density for source-meta vs referenced pills. */
  variant?: "pills" | "meta";
};

export function ClassFileList({
  files,
  showCounts = false,
  emptyLabel = "Unavailable",
  variant = "pills",
}: ClassFileListProps) {
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) {
    return <span className="dashboard__note">{emptyLabel}</span>;
  }

  if (variant === "meta") {
    const cssFiles = files.filter((item) => item.file !== "Unavailable");
    if (cssFiles.length === 0) {
      return <span className="dashboard__source-meta">Unavailable</span>;
    }
    return (
      <span className="dashboard__source-meta">
        {cssFiles.length} CSS file{cssFiles.length === 1 ? "" : "s"}
      </span>
    );
  }

  const hiddenCount = Math.max(0, files.length - PREVIEW_LIMIT);
  const visible = expanded ? files : files.slice(0, PREVIEW_LIMIT);

  return (
    <div className="dashboard__file-list">
      <ul className="dashboard__files">
        {visible.map((file) => (
          <li key={file.file}>
            <button
              type="button"
              className="dashboard__file-chip"
              title={file.file}
              aria-label={`Copy path ${file.file}`}
              onClick={() => {
                void copyPath(file.file).then((ok) => {
                  showToast(
                    ok
                      ? {
                          before: "Path ",
                          highlight: file.file,
                          after: " was copied!",
                        }
                      : "Path could not be copied",
                  );
                });
              }}
            >
              <span className="dashboard__file-chip-name">
                {fileName(file.file)}
              </span>
              {showCounts && typeof file.count === "number" ? (
                <span className="dashboard__file-chip-count">
                  ({file.count})
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="dashboard__files-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Show less"
            : `Show ${hiddenCount} more file${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </div>
  );
}

function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const name = parts[parts.length - 1];
  return name && name.length > 0 ? name : path;
}

async function copyPath(path: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(path);
      return true;
    }
  } catch {
    // Fall through to legacy copy.
  }

  try {
    const input = document.createElement("textarea");
    input.value = path;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}
