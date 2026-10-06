export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
let csrfToken = "";
const apiOrigin = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function setCsrfToken(token: string) {
  csrfToken = token;
}
export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/v1${path}`, {
      method,
      credentials: apiOrigin ? "include" : "same-origin",
      signal: options.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError("连接失败，请检查网络后重试。", 0);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("服务暂时无法响应，请稍后重试。", response.status);
  }
  if (!response.ok) {
    const e = data as { error?: string; fields?: Record<string, string> };
    throw new ApiError(
      response.status === 401 && !path.startsWith("/auth/")
        ? "登录已过期，请重新登录。"
        : response.status === 429
          ? "操作较频繁，请稍后再试。"
          : (e.error ?? "请求失败，请重试。"),
      response.status,
      e.fields,
    );
  }
  return data as T;
}
