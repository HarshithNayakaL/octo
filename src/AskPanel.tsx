import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  LoaderCircle,
  MessageCircleQuestion,
  Telescope,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { QuestionAnswer, Run } from "../shared/types";
import { api } from "./api";
import { isActive } from "./status";

const coverageLabels: Record<QuestionAnswer["coverage"], string> = {
  covered: "Answered by this research",
  partly: "Partly answered",
  not_covered: "Not in this research",
};

function suggestions(run: Run) {
  const areas = (run.plan?.areas ?? []).filter((a) => a.selected !== false);
  return [
    "What are the three most important findings?",
    "Which conclusions rest on the weakest evidence?",
    areas[0]
      ? `What did you find on ${areas[0].title.toLowerCase()}?`
      : "What is still unknown?",
    "What should I do next based on this?",
  ];
}

/** Questions answered only from this report, with gaps turned into follow-up research. */
export default function AskPanel({
  run,
  onChange,
  onError,
  onResearchGap,
  onClaim,
}: {
  run: Run;
  onChange: (run: Run) => void;
  onError: (message: string) => void;
  onResearchGap: (gap: string) => void;
  onClaim: (claimId: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const answers = [...(run.questions ?? [])].reverse();
  const canFollowUp =
    !isActive(run) &&
    run.purpose !== "crm" &&
    ["completed", "partial", "failed"].includes(run.status);
  async function ask(text: string, e?: FormEvent) {
    e?.preventDefault();
    if (text.trim().length < 3) return;
    setAsking(true);
    try {
      onChange(
        await api<Run>(`/runs/${run.id}/ask`, {
          method: "POST",
          body: JSON.stringify({ question: text.trim() }),
        }),
      );
      setQuestion("");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }
  return (
    <div className="ask-panel">
      <div className="ask-head">
        <MessageCircleQuestion size={20} />
        <div>
          <span className="small-label">ASK THIS RESEARCH</span>
          <h2>Ask questions answered only from this report</h2>
          <p className="muted">
            Answers use this report and its checked claims, not the model's
            memory or new searches. When the research doesn't cover something,
            Octo says so and offers to research it.
          </p>
        </div>
      </div>
      <form className="ask-form" onSubmit={(e) => void ask(question, e)}>
        <input
          aria-label="Ask a question about this research"
          placeholder="Ask about the findings…"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={asking}
        />
        <button
          className="primary"
          disabled={asking || question.trim().length < 3}
        >
          {asking ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <ArrowRight size={15} />
          )}
          Ask
        </button>
      </form>
      {!answers.length && (
        <div className="ask-suggestions">
          {suggestions(run).map((s) => (
            <button
              type="button"
              key={s}
              disabled={asking}
              onClick={() => void ask(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <ol className="answer-list">
        {answers.map((qa) => (
          <li key={qa.id} className={`answer ${qa.coverage}`}>
            <p className="answer-question">{qa.question}</p>
            <span className={`coverage ${qa.coverage}`}>
              {coverageLabels[qa.coverage]}
            </span>
            <div className="markdown compact">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {qa.answer}
              </ReactMarkdown>
            </div>
            {qa.claimIds.length > 0 && (
              <div className="answer-claims">
                Based on
                {qa.claimIds.map((id) => (
                  <button type="button" key={id} onClick={() => onClaim(id)}>
                    {id}
                  </button>
                ))}
              </div>
            )}
            {qa.gap && (
              <div className="answer-gap">
                <Telescope size={15} />
                <span>{qa.gap}</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={!canFollowUp}
                  title={
                    canFollowUp
                      ? undefined
                      : "Available when no research is running"
                  }
                  onClick={() => onResearchGap(qa.gap!)}
                >
                  Research this
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
