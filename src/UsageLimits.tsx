import { useEffect, useState } from "react";
import { ExternalLink, Gauge, RefreshCw } from "lucide-react";
import { api } from "./api";

export interface LimitsResponse {
  day: string;
  resetsAt: string;
  aiStudioUrl: string;
  models: {
    model: string;
    purpose: string;
    group: "research" | "voice";
    sessions?: boolean;
    requestsToday: number;
    sessionsToday?: number;
    rateLimitedToday: number;
    limits?: {
      rpm?: number;
      rpd?: number;
      tpm?: number;
      source: "ai-studio" | "google-error";
      seenAt?: string;
      quotaId?: string;
    };
  }[];
  octo: {
    voiceSessions: Allowance;
    voiceTurns: Allowance;
    writes: { max: number; windowMinutes: number };
  };
}
interface Allowance {
  remaining: number;
  max: number;
  windowMinutes: number;
  resetsInSeconds: number;
}

export function useLimits(refreshKey: unknown = 0) {
  const [limits, setLimits] = useState<LimitsResponse>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setLimits(await api<LimitsResponse>("/limits"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [refreshKey]);
  return { limits, error, loading, reload: load };
}

const time = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
const wait = (seconds: number) =>
  seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;

function Meter({
  label,
  allowance,
  unit,
}: {
  label: string;
  allowance: Allowance;
  unit: string;
}) {
  const used = allowance.max - allowance.remaining;
  const low = allowance.remaining <= Math.ceil(allowance.max * 0.2);
  return (
    <div className="allowance">
      <div className="allowance-top">
        <b>{label}</b>
        <span className={low ? "low" : ""}>
          {allowance.remaining} of {allowance.max} left
        </span>
      </div>
      <div className="allowance-bar" aria-hidden="true">
        <span
          style={{ width: `${(used / allowance.max) * 100}%` }}
          className={low ? "low" : ""}
        />
      </div>
      <small>
        {allowance.max} {unit} per{" "}
        {allowance.windowMinutes === 60
          ? "hour"
          : `${allowance.windowMinutes} minutes`}{" "}
        for each visitor
        {used > 0 && allowance.resetsInSeconds
          ? ` · next one frees up in ${wait(allowance.resetsInSeconds)}`
          : ""}
      </small>
    </div>
  );
}

/** The one-line voice allowance shown inside the voice panel. */
export function VoiceAllowance({
  limits,
  open,
  onOpen,
}: {
  limits?: LimitsResponse;
  open: boolean;
  onOpen: () => void;
}) {
  if (!limits) return null;
  const { voiceSessions: s, voiceTurns: t } = limits.octo;
  return (
    <button
      type="button"
      className="voice-allowance"
      onClick={onOpen}
      aria-expanded={open}
    >
      <Gauge size={13} />
      {s.remaining}/{s.max} live chats this hour · {t.remaining}/{t.max}{" "}
      questions per 10 min
      <span>{open ? "Back" : "Limits"}</span>
    </button>
  );
}

/** Gemini usage today, known free-tier limits, and the visitor's voice allowance. */
export default function UsageLimits({
  refreshKey,
  compact = false,
}: {
  refreshKey?: unknown;
  compact?: boolean;
}) {
  const { limits, error, loading, reload } = useLimits(refreshKey);
  if (compact) return <CompactLimits limits={limits} error={error} />;
  return (
    <section className="usage-limits" aria-labelledby="usage-title">
      <div className="usage-head">
        <div>
          <span className="small-label">GEMINI FREE TIER</span>
          <h2 id="usage-title">Usage and limits</h2>
          <p className="muted">
            Google sets free-tier limits per project and shows them in AI
            Studio; it does not publish fixed numbers. Octo shows what it sent
            today, any limit Google has reported to this project, and the voice
            allowance Octo gives each visitor.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => void reload()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>
      {error && <p className="notice error-notice">{error}</p>}
      {limits && (
        <>
          <h3>Your voice allowance</h3>
          <div className="allowance-grid">
            <Meter
              label="Live voice chats"
              allowance={limits.octo.voiceSessions}
              unit="chats"
            />
            <Meter
              label="Push-to-talk and typed questions"
              allowance={limits.octo.voiceTurns}
              unit="questions"
            />
          </div>
          <p className="muted small">
            A live chat can last up to 9 minutes and ends after 90 seconds of
            quiet. Each push-to-talk question uses one request to the answer
            model and one to the voice model.
          </p>
          <h3>Gemini requests today</h3>
          {limits.models.length ? (
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Used for</th>
                    <th>Model</th>
                    <th>Today</th>
                    <th>Free-tier limit</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.models.map((m) => (
                    <tr key={m.model + m.purpose}>
                      <td>
                        <b>{m.purpose}</b>
                        {m.rateLimitedToday > 0 && (
                          <span className="rate-hit">
                            {m.rateLimitedToday} rate-limited today
                          </span>
                        )}
                      </td>
                      <td>
                        <code>{m.model}</code>
                      </td>
                      <td>
                        {m.sessions
                          ? `${m.sessionsToday ?? 0} session${m.sessionsToday === 1 ? "" : "s"}`
                          : `${m.requestsToday} request${m.requestsToday === 1 ? "" : "s"}`}
                        {m.limits?.rpd ? (
                          <div className="usage-bar" aria-hidden="true">
                            <span
                              style={{
                                width: `${Math.min(100, ((m.sessions ? (m.sessionsToday ?? 0) : m.requestsToday) / m.limits.rpd) * 100)}%`,
                              }}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {m.limits ? (
                          <>
                            {[
                              m.limits.rpm && `${m.limits.rpm} per minute`,
                              m.limits.rpd &&
                                `${m.limits.rpd.toLocaleString()} per day`,
                              m.limits.tpm &&
                                `${m.limits.tpm.toLocaleString()} tokens/min`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            <small>
                              {m.limits.source === "ai-studio"
                                ? "From your AI Studio limits"
                                : `Reported by Google${m.limits.seenAt ? ` on ${new Date(m.limits.seenAt).toLocaleString()}` : ""}`}
                            </small>
                          </>
                        ) : (
                          <a
                            href={limits.aiStudioUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            See AI Studio
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-note">
              Add GEMINI_API_KEY to use Gemini; demo runs make no requests.
            </p>
          )}
          <p className="muted small">
            Counts are what this Octo workspace sent since midnight Pacific
            time; daily quotas reset at {time(limits.resetsAt)} your time.
            Google counts every app on the same project, so AI Studio is the
            source of truth.{" "}
            <a href={limits.aiStudioUrl} target="_blank" rel="noreferrer">
              Open your AI Studio rate limits
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}

const limitText = (m: LimitsResponse["models"][number]) =>
  m.limits
    ? [
        m.limits.rpm && `${m.limits.rpm}/min`,
        m.limits.rpd && `${m.limits.rpd.toLocaleString()}/day`,
        m.limits.tpm && `${m.limits.tpm.toLocaleString()} tokens/min`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

/** The limits view inside the voice panel: allowance first, then one line per model. */
function CompactLimits({
  limits,
  error,
}: {
  limits?: LimitsResponse;
  error: string;
}) {
  if (error) return <p className="notice error-notice">{error}</p>;
  if (!limits) return <p className="muted small">Loading limits…</p>;
  const used = (m: LimitsResponse["models"][number]) =>
    m.sessions
      ? `${m.sessionsToday ?? 0} sessions`
      : `${m.requestsToday} requests`;
  return (
    <div className="compact-limits">
      <Meter
        label="Live voice chats"
        allowance={limits.octo.voiceSessions}
        unit="chats"
      />
      <Meter
        label="Push-to-talk and typed questions"
        allowance={limits.octo.voiceTurns}
        unit="questions"
      />
      <h4>Gemini today (free tier)</h4>
      <ul>
        {limits.models.map((m) => (
          <li key={m.model + m.purpose}>
            <div>
              <b>{m.purpose}</b>
              <code>{m.model}</code>
            </div>
            <span>
              {used(m)}
              <small>
                {limitText(m) ? (
                  `Limit ${limitText(m)}${m.limits?.source === "google-error" ? " (reported by Google)" : ""}`
                ) : (
                  <a href={limits.aiStudioUrl} target="_blank" rel="noreferrer">
                    Limit: see AI Studio
                  </a>
                )}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Google sets free-tier limits per project and shows them only in AI
        Studio. Daily counts reset at {time(limits.resetsAt)} your time.
      </p>
    </div>
  );
}
