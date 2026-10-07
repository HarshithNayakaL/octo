import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileText } from "lucide-react";
import type { Run } from "../shared/types";
import {
  formatLabels,
  formatsFor,
  preferredFormat,
  type DeliverableFormat,
} from "../shared/formats";

/** Main download in the run's preferred format, with every other format one click away. */
export default function DownloadMenu({
  run,
  onDownload,
  onArtifact,
}: {
  run: Run;
  onDownload: (format: DeliverableFormat) => void;
  onArtifact: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ready = Boolean(run.report);
  const main = preferredFormat(run);
  const others = formatsFor(run).filter((f) => f !== main);
  const agentFiles = run.artifacts.filter(
    (a) => !a.path.endsWith("/research.json"),
  );
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !root.current?.contains(e.target as Node)
      ) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close, true);
    };
  }, [open]);
  const pick = (format: DeliverableFormat) => {
    setOpen(false);
    onDownload(format);
  };
  return (
    <div className="download-menu" ref={root}>
      <button
        className="primary download-main"
        disabled={!ready}
        onClick={() => onDownload(main)}
      >
        <Download size={15} />
        Download {formatLabels[main].replace(" (.docx)", "")}
      </button>
      <button
        className="primary download-toggle"
        disabled={!ready}
        aria-label="Other download formats"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="download-options" role="menu">
          <div className="download-group">Download as</div>
          {others.map((format) => (
            <button key={format} role="menuitem" onClick={() => pick(format)}>
              <FileText size={14} />
              {formatLabels[format]}
            </button>
          ))}
          {agentFiles.length > 0 && (
            <>
              <div className="download-group">Files from the agent</div>
              {agentFiles.map((file) => {
                const name = file.path.split("/").at(-1) ?? "file";
                return (
                  <button
                    key={file.id}
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onArtifact(file.id, name);
                    }}
                  >
                    <FileText size={14} />
                    {name}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
