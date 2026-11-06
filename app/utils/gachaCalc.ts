import type { GachaRecord, RecordsQuery } from "~/types/gacha";

/** 官方接口的 rarity 从 0 开始编号（0 ~ 5），本地统一 +1 成 1★ ~ 6★ */
export const RARITY_OFFSET = 1;

export const MAX_RARITY = 6;

/** 把官方原始星级换算成本地口径：0→1★ … 5→6★，越界值夹到 1 ~ 6 */
export function normalizeRarity(raw: number): number {
  if (!Number.isFinite(raw)) return RARITY_OFFSET;
  return Math.min(MAX_RARITY, Math.max(1, Math.floor(raw) + RARITY_OFFSET));
}

/** 官方时间戳既可能是秒也可能是毫秒，统一成毫秒 */
export function toMillis(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

export function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function pickNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

export function pickBoolean(source: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
    }
  }
  return false;
}

/**
 * 把官方原始记录转换成内部结构。
 * 字段名做过兼容处理（官方在多次改版中出现过 snake_case 与缩写）。
 */
export function normalizeRecord(raw: unknown, categoryId: string): GachaRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const gachaTs = toMillis(pickNumber(source, ["gachaTs", "gacha_ts", "ts", "timestamp", "time"]));
  const pos = pickNumber(source, ["pos", "position", "index"]);
  const charId = pickString(source, ["charId", "char_id", "charID", "id"]);
  const charName = pickString(source, ["charName", "char_name", "name"]);
  const rarity = normalizeRarity(pickNumber(source, ["rarity", "star", "starLevel"]));
  if (!gachaTs || !charName) return null;

  const poolId = pickString(source, ["poolId", "pool_id"]);
  const poolName = pickString(source, ["poolName", "pool_name", "pool"]) || poolId || "未知卡池";

  return {
    id: recordKey({ gachaTs, pos, charId, charName }),
    gachaTs,
    pos,
    charId,
    charName,
    rarity,
    isNew: pickBoolean(source, ["isNew", "is_new"]),
    poolId,
    poolName,
    categoryId,
  };
}

/** 去重主键：同一次十连内 `gachaTs` 相同，`pos` 区分批次内位置 */
export function recordKey(record: Pick<GachaRecord, "gachaTs" | "pos" | "charId" | "charName">): string {
  return `${record.gachaTs}|${record.pos}|${record.charId || record.charName}`;
}

/** 新记录在前：时间戳倒序，同批次内位置倒序 */
export function sortRecordsDesc(records: GachaRecord[]): GachaRecord[] {
  return [...records].sort((a, b) => {
    if (b.gachaTs !== a.gachaTs) return b.gachaTs - a.gachaTs;
    if (b.pos !== a.pos) return b.pos - a.pos;
    return a.charName.localeCompare(b.charName, "zh-Hans-CN");
  });
}

/** 出货顺序：时间戳正序，同批次内位置正序，用于计算垫抽 */
export function sortRecordsAsc(records: GachaRecord[]): GachaRecord[] {
  return [...records].sort((a, b) => {
    if (a.gachaTs !== b.gachaTs) return a.gachaTs - b.gachaTs;
    if (a.pos !== b.pos) return a.pos - b.pos;
    return a.charName.localeCompare(b.charName, "zh-Hans-CN");
  });
}

/**
 * 合并本地与远端记录。
 * - 以 `recordKey` 去重，已存在的记录保留本地不可再生字段（`isNew`）
 * - 结果按时间倒序
 */
export function mergeRecords(
  existing: GachaRecord[],
  incoming: GachaRecord[],
): { records: GachaRecord[]; added: number; total: number } {
  const map = new Map<string, GachaRecord>();
  for (const record of existing) map.set(recordKey(record), record);

  let added = 0;
  for (const record of incoming) {
    const key = recordKey(record);
    const current = map.get(key);
    if (current) {
      // 官方偶尔会修正名称/卡池信息，但 isNew 一旦为 true 不应回退
      map.set(key, {
        ...current,
        charName: record.charName || current.charName,
        poolName: record.poolName || current.poolName,
        poolId: record.poolId || current.poolId,
        rarity: record.rarity || current.rarity,
        isNew: current.isNew || record.isNew,
      });
      continue;
    }
    map.set(key, record);
    added++;
  }

  const records = sortRecordsDesc([...map.values()]);
  return { records, added, total: records.length };
}

export function filterRecords(records: GachaRecord[], query: RecordsQuery): GachaRecord[] {
  const search = query.search?.trim().toLowerCase();
  return records.filter((record) => {
    if (query.categoryId && record.categoryId !== query.categoryId) return false;
    if (query.rarity && record.rarity !== query.rarity) return false;
    if (search) {
      const haystack = `${record.charName} ${record.poolName} ${record.charId}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}


/** 同步翻页之间的随机延迟，防风控 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
