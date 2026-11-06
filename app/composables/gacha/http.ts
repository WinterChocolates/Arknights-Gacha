import { invoke } from "@tauri-apps/api/core";
import { delay } from "~/utils/gachaCalc";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 用户取消（页面上的「取消同步」） */
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  retryAfter?: number;

  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** 外部信号触发的取消，重试与归类都需要识别它 */
export class AbortedError extends Error {
  constructor(message = "请求已取消") {
    super(message);
    this.name = "AbortedError";
  }
}

export interface HttpClientOptions {
  timeoutMs?: number;
  /** 失败重试次数（不含首次请求） */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  onRetry?: (info: { url: string; attempt: number; error: string; waitMs: number }) => void;
}


function shouldRetryStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfter(headers: Record<string, string>): number | null {
  const raw = headers["retry-after"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 10_000);
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return Math.min(Math.max(ts - Date.now(), 0), 10_000);
  return null;
}

function truncate(text: string, max = 200): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * 全部请求都经 Rust 侧转发（`http_request` 命令）。
 *
 * WebView 里直接 fetch 鹰角接口会被 CORS 拦掉（对方不返回 Access-Control-Allow-Origin），
 * 而 Rust 侧的 reqwest 还顺手解决了 session cookie 的保存与回放。
 */
export class HttpClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly onRetry: HttpClientOptions["onRetry"];

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = Math.max(options.maxRetries ?? 3, 0);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 400;
    this.onRetry = options.onRetry;
  }

  /** 只拿到原始响应文本，适合先建立会话再读 cookie 的页面请求 */
  request(url: string, init: HttpRequestInit = {}): Promise<RawResponse> {
    return this.withRetry(url, init, (response) => response);
  }

  /** 解析 JSON；非 JSON 响应（风控页会返回 HTML）也算一次失败，会重试 */
  json<T>(url: string, init: HttpRequestInit = {}): Promise<T> {
    return this.withRetry(url, init, (response) => {
      try {
        return JSON.parse(response.body) as T;
      } catch {
        throw new HttpError(`响应不是合法的 JSON（HTTP ${response.status}）`, 0, response.body);
      }
    });
  }

  getJson<T>(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    return this.json<T>(url, { method: "GET", ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) });
  }

  postJson<T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.json<T>(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      ...(signal ? { signal } : {}),
    });
  }

  private async attempt(url: string, init: HttpRequestInit): Promise<RawResponse> {
    const response = await invoke<RawResponse>("http_request", {
      request: {
        url,
        method: (init.method ?? "GET").toUpperCase(),
        headers: {
          "user-agent": DEFAULT_USER_AGENT,
          accept: "application/json, text/plain, */*",
          ...(init.headers ?? {}),
        },
        body: init.body ?? null,
        timeoutMs: init.timeoutMs ?? this.timeoutMs,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      const error = new HttpError(
        `请求失败（HTTP ${response.status}）${response.body ? `：${truncate(response.body)}` : ""}`,
        response.status,
        response.body,
      );
      if (shouldRetryStatus(response.status)) {
        error.retryAfter = parseRetryAfter(response.headers) ?? undefined;
      }
      throw error;
    }

    return response;
  }

  private async withRetry<T>(
    url: string,
    init: HttpRequestInit,
    run: (response: RawResponse) => T,
  ): Promise<T> {
    const attempts = this.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (init.signal?.aborted) throw new AbortedError();
      try {
        return run(await this.attempt(url, init));
      } catch (error) {
        lastError = error;
        // 用户主动取消：不再重试，直接中断
        if (init.signal?.aborted) throw new AbortedError();
        if (error instanceof AbortedError) throw error;

        const retryable =
          error instanceof HttpError ? shouldRetryStatus(error.status) : error instanceof Error;
        if (!retryable || attempt === attempts) break;

        const backoff = this.retryBaseDelayMs * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 200);
        const retryAfter = error instanceof HttpError ? error.retryAfter : undefined;
        const waitMs = retryAfter ?? Math.min(backoff + jitter, 8_000);
        this.onRetry?.({
          url,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          waitMs,
        });
        await delay(waitMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/** 新的同步开始前清掉旧的 session cookie */
export async function resetHttpCookies(): Promise<void> {
  await invoke("reset_cookies").catch(() => undefined);
}
