import { invoke } from "@tauri-apps/api/core";
import type { Account, GachaRecord, StoredAccount, SyncSettings } from "~/types/gacha";
import { mergeRecords, normalizeRarity, sortRecordsDesc } from "~/utils/gachaCalc";

export const DEFAULT_SETTINGS: SyncSettings = {
  pageSize: 50,
  delayMinMs: 400,
  delayMaxMs: 900,
  maxRetries: 3,
  requestTimeoutMs: 15_000,
  maxPagesPerCategory: 400,
};

interface ConfigFile {
  version: number;
  settings: SyncSettings;
  accounts: StoredAccount[];
}

/** v1：rarity 直接沿用官方 0 基编号；v2：统一 +1 成 1★ ~ 6★ */
const CONFIG_VERSION = 1;
const RECORDS_VERSION = 2;

interface RecordsFile {
  version: number;
  uid: string;
  updatedAt: number;
  records: GachaRecord[];
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function normalizeSettings(
  patch?: Partial<SyncSettings>,
  base: SyncSettings = DEFAULT_SETTINGS,
): SyncSettings {
  const merged = { ...base, ...(patch ?? {}) };
  const delayMinMs = clampInt(merged.delayMinMs, base.delayMinMs, 0, 10_000);
  const delayMaxMs = clampInt(merged.delayMaxMs, base.delayMaxMs, delayMinMs, 20_000);
  return {
    pageSize: clampInt(merged.pageSize, base.pageSize, 1, 50),
    delayMinMs,
    delayMaxMs,
    maxRetries: clampInt(merged.maxRetries, base.maxRetries, 0, 10),
    requestTimeoutMs: clampInt(merged.requestTimeoutMs, base.requestTimeoutMs, 1_000, 120_000),
    maxPagesPerCategory: clampInt(merged.maxPagesPerCategory, base.maxPagesPerCategory, 1, 5_000),
  };
}

/** 去掉凭证后给页面用 */
export function toPublicAccount(account: StoredAccount): Account {
  const { token: _token, u8Token: _u8Token, ...rest } = account;
  return rest;
}


function isValidRecord(record: unknown): record is GachaRecord {
  if (!record || typeof record !== "object") return false;
  const item = record as Partial<GachaRecord>;
  return (
    typeof item.gachaTs === "number" &&
    Number.isFinite(item.gachaTs) &&
    typeof item.charName === "string" &&
    item.charName.length > 0
  );
}

/**
 * 本地 JSON 存储（真实落盘在 Rust 侧）：
 *   config.json          账号与设置（含 token，不上传任何服务器）
 *   gachaData/<uid>.json 寻访记录
 *
 * Rust 侧的写入是「临时文件 + rename」的原子替换，并保留上一版 `.bak`；
 * 读取失败时会自动回退到 `.bak`。
 */
export class GachaStore {
  private readonly cache = new Map<string, GachaRecord[]>();

  async readConfig(): Promise<ConfigFile> {
    const raw = (await invoke<Partial<ConfigFile>>("read_config")) ?? {};
    const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    return {
      version: CONFIG_VERSION,
      settings: normalizeSettings(raw.settings),
      accounts: accounts.map((account) => ({
        ...account,
        categories: Array.isArray(account.categories) ? account.categories : [],
        recordCount: Number(account.recordCount) || 0,
        lastSyncAt: account.lastSyncAt ?? null,
        lastSyncMode: account.lastSyncMode ?? null,
        lastSyncStatus: account.lastSyncStatus ?? null,
      })),
    };
  }

  async writeConfig(config: ConfigFile): Promise<void> {
    await invoke("save_config", { data: config });
  }

  async getSettings(): Promise<SyncSettings> {
    return (await this.readConfig()).settings;
  }

  async saveSettings(patch: Partial<SyncSettings>): Promise<SyncSettings> {
    const config = await this.readConfig();
    config.settings = normalizeSettings(patch, config.settings);
    await this.writeConfig(config);
    return config.settings;
  }

  async listAccounts(): Promise<StoredAccount[]> {
    return (await this.readConfig()).accounts;
  }

  async findAccount(uid: string): Promise<StoredAccount | null> {
    return (await this.listAccounts()).find((account) => account.uid === uid) ?? null;
  }

  /** 新增或按 uid 合并更新账号（保留 createdAt，刷新凭证与元数据） */
  async upsertAccount(
    input: Pick<StoredAccount, "uid" | "nickName" | "channel" | "token"> &
      Partial<Pick<StoredAccount, "u8Token" | "categories" | "recordCount">>,
  ): Promise<StoredAccount> {
    const config = await this.readConfig();
    const now = Date.now();
    const index = config.accounts.findIndex((account) => account.uid === input.uid);
    const previous = index >= 0 ? config.accounts[index] : undefined;

    const account: StoredAccount = {
      uid: input.uid,
      nickName: input.nickName || previous?.nickName || `博士 ${input.uid}`,
      channel: input.channel ?? previous?.channel ?? "official",
      token: input.token,
      u8Token: input.u8Token ?? previous?.u8Token,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastSyncAt: previous?.lastSyncAt ?? null,
      lastSyncMode: previous?.lastSyncMode ?? null,
      lastSyncStatus: previous?.lastSyncStatus ?? null,
      recordCount: input.recordCount ?? previous?.recordCount ?? 0,
      categories: input.categories ?? previous?.categories ?? [],
    };

    if (index >= 0) config.accounts[index] = account;
    else config.accounts.push(account);

    await this.writeConfig(config);
    return account;
  }

  async patchAccount(
    uid: string,
    patch: Partial<
      Pick<
        StoredAccount,
        | "nickName"
        | "channel"
        | "token"
        | "u8Token"
        | "categories"
        | "recordCount"
        | "lastSyncAt"
        | "lastSyncMode"
        | "lastSyncStatus"
      >
    >,
  ): Promise<StoredAccount | null> {
    const config = await this.readConfig();
    const index = config.accounts.findIndex((account) => account.uid === uid);
    const current = index >= 0 ? config.accounts[index] : undefined;
    if (!current) return null;

    const next: StoredAccount = { ...current, ...patch, updatedAt: Date.now() };
    config.accounts[index] = next;
    await this.writeConfig(config);
    return next;
  }

  async deleteAccount(uid: string): Promise<boolean> {
    const config = await this.readConfig();
    const before = config.accounts.length;
    config.accounts = config.accounts.filter((account) => account.uid !== uid);
    if (config.accounts.length === before) return false;
    await this.writeConfig(config);
    this.cache.delete(uid);
    await invoke("delete_records", { uid }).catch(() => undefined);
    return true;
  }

  async readRecords(uid: string): Promise<GachaRecord[]> {
    const cached = this.cache.get(uid);
    if (cached) return cached;

    const data = (await invoke<Partial<RecordsFile>>("read_records", { uid })) ?? {};
    const records = (Array.isArray(data.records) ? data.records : []).filter(isValidRecord);

    // v1 记录的 rarity 是官方 0 基编号，读取时顺手迁移成 1★ ~ 6★ 并落盘
    if (!(Number(data.version) >= RECORDS_VERSION)) {
      const migrated = records.map((record) => ({ ...record, rarity: normalizeRarity(record.rarity) }));
      await this.writeRecords(uid, migrated).catch(() => undefined);
      return this.cache.get(uid) ?? sortRecordsDesc(migrated);
    }

    const sorted = sortRecordsDesc(records);
    this.cache.set(uid, sorted);
    return sorted;
  }

  async writeRecords(uid: string, records: GachaRecord[]): Promise<void> {
    const file: RecordsFile = {
      version: RECORDS_VERSION,
      uid,
      updatedAt: Date.now(),
      records: sortRecordsDesc(records),
    };
    await invoke("save_records", { uid, data: file });
    this.cache.set(uid, file.records);
  }

  /** 合并写入并返回新增条数 */
  async mergeRecords(uid: string, incoming: GachaRecord[]): Promise<{ added: number; total: number }> {
    const existing = await this.readRecords(uid);
    const outcome = mergeRecords(existing, incoming);
    if (outcome.added > 0 || existing.length === 0) {
      await this.writeRecords(uid, outcome.records);
    }
    return { added: outcome.added, total: outcome.total };
  }
}

export const gachaStore = new GachaStore();
