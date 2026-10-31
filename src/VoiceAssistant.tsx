import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { Configuration, VoiceAction } from "../shared/types";
import { workflowLabels } from "../shared/types";
import UsageLimits, { VoiceAllowance, useLimits } from "./UsageLimits";
import {
  LiveSession,
  TurnSession,
  type VoiceContext,
  type VoiceLine,
  type VoiceMode,
  type VoiceState,
} from "./voice/session";

const stateLabels: Record<VoiceState, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong",
};

/**
 * Octo's voice assistant: a mic button that is always on screen, and a panel
 * for talking to Octo. Gemini Live first; push-to-talk with Gemini TTS when
 * Live is unavailable.
 */
export default function VoiceAssistant({
  config,
  context,
  onPrepareResearch,
}: {
  config?: Configuration;
  context: VoiceContext;
  onPrepareResearch: (action: VoiceAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("live");
  const [state, setState] = useState<VoiceState>("idle");
  const [detail, setDetail] = useState("");
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<VoiceAction>();
  const [muted, setMuted] = useState(false);
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const session = useRef<LiveSession | TurnSession | undefined>(undefined);
  const contextRef = useRef(context);
  contextRef.current = context;
  const scroller = useRef<HTMLDivElement>(null);
  // Refresh the allowance when the panel opens and after each answer.
  const [limitsKey, setLimitsKey] = useState(0);
  const { limits } = useLimits(open ? limitsKey : -1);
  const [showLimits, setShowLimits] = useState(false);
  // Unknown until the config loads; only a confirmed "unavailable" blocks the mic.
  const unavailable = config?.voice?.available === false;
  const events = {
    state: (s: VoiceState, d?: string) => {
      if (s === "listening" || s === "speaking") setLimitsKey((k) => k + 1);
      setState(s);
      setDetail(d ?? "");
    },
    line: (line: VoiceLine) =>
      setLines((all) => {
        const i = all.findIndex((l) => l.id === line.id);
        if (i < 0) return [...all, line].slice(-40);
        const next = [...all];
        next[i] = line;
        return next;
      }),
    action: (a: VoiceAction) => {
      setLimitsKey((k) => k + 1);
      setAction(a);
      onPrepareResearch(a);
    },
    level: (l: number) => setLevel(Math.min(1, l * 6)),
    notice: (m: string) => setNotice(m),
  };
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines, action]);
  useEffect(() => () => void session.current?.stop(), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function startTurn(message?: string) {
    const turn = new TurnSession(events, () => contextRef.current);
    session.current = turn;
    setMode("turn");
    await turn.start();
    if (message) setNotice(message);
  }
  async function begin() {
    setNotice("");
    setAction(undefined);
    if (unavailable) {
      setState("error");
      setDetail(
        "The voice assistant needs GEMINI_API_KEY on the server. Add it and redeploy.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      await startTurn(
        "This browser can't use the microphone here. Type your question below.",
      );
      return;
    }
    const live = new LiveSession(events, () => contextRef.current);
    session.current = live;
    setMode("live");
    try {
      await live.start();
    } catch (err) {
      await live.stop().catch(() => undefined);
      const message = (err as Error).message;
      if (/permission|denied|notallowed/i.test(message)) {
        setState("error");
        setDetail(
          "Microphone access was blocked. Allow it in the browser, or type below.",
        );
        await startTurn();
        return;
      }
      await startTurn(
        `Gemini Live is unavailable (${message}). Using push-to-talk instead.`,
      );
    }
  }
  async function toggle() {
    if (open) return close();
    setOpen(true);
    setLines([]);
    await begin();
  }
  async function close() {
    setOpen(false);
    const current = session.current;
    session.current = undefined;
    await current?.stop();
    setState("idle");
    setLevel(0);
  }
  async function micPressed() {
    const current = session.current;
    if (current instanceof TurnSession) {
      try {
        await current.record();
      } catch (err) {
        setState("error");
        setDetail((err as Error).message);
      }
      return;
    }
    if (current instanceof LiveSession && current.state !== "idle") {
      const next = !muted;
      setMuted(next);
      current.setMuted(next);
      return;
    }
    setMuted(false);
    await begin();
  }
  async function submitText(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    if (
      !session.current ||
      (session.current.state === "idle" &&
        session.current instanceof LiveSession)
    )
      await startTurn();
    await session.current?.sendText(message);
  }
  const recording =
    session.current instanceof TurnSession && session.current.recording;
  const live = mode === "live" && session.current instanceof LiveSession;
  return (
    <>
      <button
        type="button"
        className={`voice-fab ${open ? "open" : ""} ${state}`}
        onClick={() => void toggle()}
        aria-label={open ? "Close voice assistant" : "Talk to Octo"}
        aria-expanded={open}
        title={
          open ? "Close voice assistant" : "Talk to Octo (voice assistant)"
        }
      >
        <span className="voice-fab-ring" aria-hidden="true" />
        {open ? <X size={22} /> : <Mic size={22} />}
        {!open && <span className="voice-fab-label">Talk to Octo</span>}
      </button>
      {open && (
        <section
          className="voice-panel"
          role="dialog"
          aria-label="Octo voice assistant"
        >
          <header className="voice-head">
            <div>
              <b>Octo voice</b>
              <span className={`voice-mode ${mode}`}>
                {mode === "live"
                  ? `Live · ${config?.voice?.live ?? "Gemini Live"}`
                  : `Push-to-talk · ${config?.voice?.turn ?? "Gemini"}`}
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={() => void close()}
            >
              <X size={16} />
            </button>
          </header>
          <div className="voice-stage">
            <div
              className={`voice-orb ${state}`}
              style={{ ["--level" as string]: String(level) }}
              aria-hidden="true"
            >
              <span />
            </div>
            <p className="voice-status" aria-live="polite">
              <b>{stateLabels[state]}</b>
              {detail && <span>{detail}</span>}
            </p>
          </div>
          <VoiceAllowance
            limits={limits}
            open={showLimits}
            onOpen={() => setShowLimits((v) => !v)}
          />
          {showLimits ? (
            <div className="voice-lines">
              <UsageLimits compact refreshKey={limitsKey} />
            </div>
          ) : (
            <div className="voice-lines" ref={scroller}>
              {!lines.length && (
                <div className="voice-hints">
                  <p>Ask anything, for example:</p>
                  {(context.runId
                    ? [
                        "What are the key findings here?",
                        "Which claims are weakest?",
                        "Summarise this in two sentences",
                      ]
                    : [
                        "What can Octo do?",
                        "Research the EV charging market in India",
                        "How does the evidence check work?",
                      ]
                  ).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (!session.current) await startTurn();
                          await session.current?.sendText(h);
                        })();
                      }}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
              {lines.map((l) => (
                <div
                  key={l.id}
                  className={`voice-line ${l.role} ${l.final ? "" : "partial"}`}
                >
                  <span>{l.role === "user" ? "You" : "Octo"}</span>
                  <p>{l.text}</p>
                </div>
              ))}
              {action && (
                <div className="voice-action">
                  <Sparkles size={15} />
                  <div>
                    <b>Research form ready</b>
                    <p>
                      {action.title} · {workflowLabels[action.workflow]}
                    </p>
                    <small>
                      Review it and press Continue to start. Nothing has run
                      yet.
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onPrepareResearch(action)}
                  >
                    Open
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
          {notice && <p className="voice-notice">{notice}</p>}
          <footer className="voice-foot">
            <form onSubmit={(e) => void submitText(e)}>
              <input
                aria-label="Type to Octo"
                placeholder={live ? "Or type a message…" : "Type a question…"}
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="Send message"
                disabled={!text.trim()}
              >
                <Send size={15} />
              </button>
            </form>
            <button
              type="button"
              className={`voice-mic ${recording ? "recording" : ""} ${live && muted ? "muted" : ""}`}
              onClick={() => void micPressed()}
              disabled={state === "connecting" || state === "thinking"}
              aria-label={
                mode === "turn"
                  ? recording
                    ? "Stop recording"
                    : "Record a question"
                  : live
                    ? muted
                      ? "Unmute microphone"
                      : "Mute microphone"
                    : "Start talking"
              }
            >
              {mode === "turn" ? (
                recording ? (
                  <Square size={18} />
                ) : (
                  <Mic size={20} />
                )
              ) : live && muted ? (
                <MicOff size={20} />
              ) : (
                <Mic size={20} />
              )}
            </button>
          </footer>
          <p className="voice-fine">
            Gemini on the free tier · Your voice goes to Google to answer you ·
            Octo opens forms, it never starts research on its own
          </p>
        </section>
      )}
    </>
  );
}
