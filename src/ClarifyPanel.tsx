import { useState } from "react";
import { ArrowRight, Check, Lightbulb, Target } from "lucide-react";
import type { Run } from "../shared/types";
import { Mascot, areaProfile, director } from "./agents";

export interface ClarifySubmission {
  answers?: { questionId: string; selected: string[]; note?: string }[];
  areas?: string[];
  extraContext?: string;
}

/** Octo's reading of the brief, its proposed areas, and questions to answer before research. */
export default function ClarifyPanel({
  run,
  busy,
  onSubmit,
  onCancel,
}: {
  run: Run;
  busy: boolean;
  onSubmit: (submission: ClarifySubmission) => void;
  onCancel: () => void;
}) {
  const plan = run.plan;
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [areas, setAreas] = useState<string[]>(
    plan?.areas.filter((a) => a.selected !== false).map((a) => a.title) ?? [],
  );
  const [extra, setExtra] = useState("");
  const toggle = (questionId: string, option: string, multiple: boolean) =>
    setSelected((current) => {
      const list = current[questionId] ?? [];
      const next = list.includes(option)
        ? list.filter((o) => o !== option)
        : multiple
          ? [...list, option]
          : [option];
      return { ...current, [questionId]: next };
    });
  const submit = (skip = false) =>
    onSubmit(
      skip
        ? {}
        : {
            answers: (plan?.questions ?? []).map((q) => ({
              questionId: q.id,
              selected: selected[q.id] ?? [],
              note: notes[q.id]?.trim() || undefined,
            })),
            areas: plan ? areas : undefined,
            extraContext: extra.trim() || undefined,
          },
    );
  const answered = (plan?.questions ?? []).filter(
    (q) => (selected[q.id] ?? []).length || notes[q.id]?.trim(),
  ).length;
  return (
    <div className="clarify">
      <div className="clarify-intro">
        <Mascot profile={director} size={40} />
        <div>
          <span className="small-label">BEFORE RESEARCH STARTS</span>
          <h2>
            {plan
              ? "Here is what I understood. Help me aim the research."
              : "Ready when you are."}
          </h2>
          {run.mode === "demo" && (
            <p className="clarify-demo">
              Demo: these questions are illustrative. Live runs ask questions
              about your own brief and files.
            </p>
          )}
        </div>
      </div>
      {!plan && (
        <div className="notice error-notice">
          <p>
            {run.planError ??
              "Questions could not be prepared. You can start the research without them."}
          </p>
        </div>
      )}
      {plan && (
        <>
          <div className="clarify-summary">
            <div>
              <Lightbulb size={16} />
              <div>
                <b>What I understood</b>
                <p>{plan.understanding}</p>
              </div>
            </div>
            <div>
              <Target size={16} />
              <div>
                <b>The outcome I think you want</b>
                <p>{plan.outcome}</p>
              </div>
            </div>
          </div>
          <section className="clarify-block">
            <h3>Research areas</h3>
            <p className="muted">
              One specialist covers each area you keep. Turn off anything you do
              not need.
            </p>
            <div className="area-grid">
              {plan.areas.map((area, i) => {
                const on = areas.includes(area.title);
                return (
                  <button
                    type="button"
                    key={area.title}
                    className={`area-chip ${on ? "on" : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      setAreas((list) =>
                        on
                          ? list.filter((t) => t !== area.title)
                          : [...list, area.title],
                      )
                    }
                  >
                    <Mascot
                      profile={areaProfile(area.title, i)}
                      size={26}
                      paused
                      label=""
                    />
                    <span>
                      <b>{area.title}</b>
                      {area.focus}
                    </span>
                    <span className="area-check">
                      {on && <Check size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          {plan.questions.map((q, n) => (
            <section className="clarify-block" key={q.id}>
              <h3>
                <span className="question-number">{n + 1}</span>
                {q.question}
              </h3>
              {q.why && <p className="muted">{q.why}</p>}
              <div
                className="option-row"
                role={q.multiple ? "group" : "radiogroup"}
                aria-label={q.question}
              >
                {q.options.map((option) => {
                  const on = (selected[q.id] ?? []).includes(option);
                  return (
                    <button
                      type="button"
                      key={option}
                      role={q.multiple ? "checkbox" : "radio"}
                      aria-checked={on}
                      className={`option-chip ${on ? "on" : ""}`}
                      onClick={() => toggle(q.id, option, Boolean(q.multiple))}
                    >
                      {on && <Check size={13} />}
                      {option}
                    </button>
                  );
                })}
              </div>
              <input
                className="option-note"
                aria-label={`Add detail: ${q.question}`}
                placeholder={
                  q.multiple
                    ? "Choose any that apply, or add your own detail…"
                    : "Something else? Type it here…"
                }
                value={notes[q.id] ?? ""}
                onChange={(e) =>
                  setNotes((current) => ({
                    ...current,
                    [q.id]: e.target.value,
                  }))
                }
              />
            </section>
          ))}
        </>
      )}
      <section className="clarify-block">
        <h3>Anything else I should know?</h3>
        <textarea
          aria-label="Anything else for the research"
          rows={3}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Constraints, sources to trust or avoid, what you will do with the result…"
        />
      </section>
      <div className="clarify-actions">
        <button
          className="quiet"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        {plan && (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => submit(true)}
          >
            Skip questions
          </button>
        )}
        <button
          className="primary"
          type="button"
          disabled={busy || (Boolean(plan) && areas.length === 0)}
          onClick={() => submit()}
        >
          Start research
          <ArrowRight size={15} />
        </button>
        {plan && (
          <small>
            {answered} of {plan.questions.length} answered · {areas.length} of{" "}
            {plan.areas.length} areas
          </small>
        )}
      </div>
    </div>
  );
}
