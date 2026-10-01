/** Keeps both ends of a long URL or path visible: the middle collapses first. */
export default function MiddleTruncate({
  text,
  tail = 16,
  className = "",
}: {
  text: string;
  tail?: number;
  className?: string;
}) {
  const split = Math.max(0, text.length - tail);
  return (
    <span className={`middle-truncate ${className}`} title={text}>
      <span className="middle-truncate-head">{text.slice(0, split)}</span>
      <span className="middle-truncate-tail">{text.slice(split)}</span>
    </span>
  );
}

export const displayUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return (parsed.hostname + parsed.pathname + parsed.search).replace(
      /\/$/,
      "",
    );
  } catch {
    return url;
  }
};
