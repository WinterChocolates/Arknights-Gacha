// 星级配色 / 图表配色见 ~/utils/theme.ts
const pad = (value: number): string => String(value).padStart(2, "0");

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 精确到秒的时间（CSV 导出、文件名时间戳） */
export function formatDateTimeSeconds(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDateTime(ts)}:${pad(date.getSeconds())}`;
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ratio 为 0 ~ 1 的占比 */
export function formatPercent(ratio: number, digits = 2): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} 分 ${rest} 秒`;
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "从未";
  const diff = Date.now() - ts;
  if (diff < 0) return formatDateTime(ts);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(ts);
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}
