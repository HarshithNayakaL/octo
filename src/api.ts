export const accessToken = () =>
  sessionStorage.getItem("workspace-token") ?? "";
const UNLOCK_KEY = "openai-unlock";
/** Proof of the OpenAI access word for this tab. The word itself is never stored. */
export const openaiUnlock = {
  get: () => sessionStorage.getItem(UNLOCK_KEY) ?? "",
  set: (token: string) => sessionStorage.setItem(UNLOCK_KEY, token),
  clear: () => sessionStorage.removeItem(UNLOCK_KEY),
};
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(accessToken() ? { Authorization: "Bearer " + accessToken() } : {}),
      ...(openaiUnlock.get() ? { "X-OpenAI-Unlock": openaiUnlock.get() } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // A changed word invalidates earlier unlocks; forget the stale one.
    if (data.code === "openai_locked") openaiUnlock.clear();
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}
export async function download(path: string, name: string) {
  const nativeDownload = !accessToken();
  const response = await fetch("/api" + path, {
    method: nativeDownload ? "HEAD" : "GET",
    headers: accessToken()
      ? { Authorization: "Bearer " + accessToken() }
      : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "Download failed");
  }
  const url = nativeDownload
    ? "/api" + path
    : URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  if (!nativeDownload) setTimeout(() => URL.revokeObjectURL(url), 60000);
}
