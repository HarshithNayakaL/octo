import { Command } from "cmdk";
import {
  ArrowUpRight,
  Building2,
  FileText,
  Globe2,
  Radio,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { Run, Workflow } from "../shared/types";

export default function SearchDialog({
  open,
  onClose,
  runs,
  onOpen,
  onCreate,
  onSettings,
}: {
  open: boolean;
  onClose: () => void;
  runs: Run[];
  onOpen: (id: string) => void;
  onCreate: (w: Workflow) => void;
  onSettings: () => void;
}) {
  return (
    <Command.Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      label="Search your workspace"
      overlayClassName="command-overlay"
      contentClassName="command-dialog"
    >
      <div className="command-search">
        <Search size={19} />
        <Command.Input placeholder="Find research or an action…" autoFocus />
        <button onClick={onClose} aria-label="Close search">
          <X size={17} />
        </button>
      </div>
      <Command.List>
        <Command.Empty>
          No matching research. Try a different question.
        </Command.Empty>
        <Command.Group heading="Create research">
          {(
            [
              { key: "market", name: "Market intelligence", icon: Globe2 },
              { key: "sales", name: "Sales research", icon: Building2 },
              { key: "monitor", name: "Ongoing research", icon: Radio },
            ] as const
          ).map((item) => (
            <Command.Item
              key={item.key}
              value={"New " + item.name}
              onSelect={() => {
                onClose();
                onCreate(item.key);
              }}
            >
              <item.icon size={17} />
              <span>New {item.name.toLowerCase()}</span>
              <ArrowUpRight size={15} />
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Saved research">
          {runs.map((run) => (
            <Command.Item
              key={run.id}
              value={run.title + " " + run.id}
              keywords={[run.workflow, run.brief]}
              onSelect={() => {
                onClose();
                onOpen(run.id);
              }}
            >
              <FileText size={17} />
              <span>{run.title}</span>
              <small>{run.mode === "demo" ? "Demo" : run.status}</small>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Workspace">
          <Command.Item
            onSelect={() => {
              onClose();
              onSettings();
            }}
          >
            <Settings2 size={17} />
            <span>Workspace settings</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
      <div className="command-footer">
        <span>Use arrow keys to navigate</span>
        <kbd>Enter</kbd>
        <span>to open</span>
        <kbd>Esc</kbd>
        <span>to close</span>
      </div>
    </Command.Dialog>
  );
}
