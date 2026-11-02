import type { Run } from "../shared/types";

export const isActive = (run: Run) =>
  ["planning", "starting", "running", "requires_action"].includes(run.status);
const labels: Partial<Record<Run["status"], string>> = {
  planning: "Preparing questions",
  awaiting_input: "Needs your input",
  requires_action: "Requires action",
  partial: "Partial",
};
/** Human wording for a run's status. */
export const statusLabel = (run: Run) => {
  const label =
    run.cancelRequested && isActive(run)
      ? "Stopping"
      : (labels[run.status] ?? run.status.replaceAll("_", " "));
  // Sentence case: "Needs your input", "Completed".
  return label.charAt(0).toUpperCase() + label.slice(1);
};
/** Live remote research is running, so the run cannot be deleted yet. */
export const deletable = (run: Run) =>
  !(
    run.mode === "live" &&
    ["starting", "running", "requires_action"].includes(run.status)
  );
