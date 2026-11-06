import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountChannel,
  GachaStats,
  RecordsPage,
  SyncMode,
  SyncProgress,
  SyncResult,
  SyncSettings,
  SyncTaskState,
} from "~/types/gacha";
import { ArknightsClient, type BindingOptionResult } from "~/composables/gacha/api";
import { HttpClient } from "~/composables/gacha/http";
import { computeStats } from "~/composables/gacha/stats";
import { cancelSyncTask, latestTaskState, startSyncTask } from "~/composables/gacha/sync";
import { gachaStore, toPublicAccount } from "~/composables/gacha/store";
import { filterRecords } from "~/utils/gachaCalc";
import { toCsv, toRawJson } from "~/utils/gachaExport";

export interface RecordFilters {
  categoryId: string;
  rarity: number;
  search: string;
}

export type ExportKind = "csv" | "json";

interface LoadingFlags {
  boot: boolean;
  stats: boolean;
  records: boolean;
}

const EMPTY_RECORDS: RecordsPage = { items: [], total: 0, page: 1, pageSize: 50 };

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** 按当前设置构造客户端（重试次数与超时来自「设置」页） */
function createClient(settings: SyncSettings | null): ArknightsClient {
  return new ArknightsClient(
    new HttpClient({
      maxRetries: settings?.maxRetries ?? 3,
      timeoutMs: settings?.requestTimeoutMs ?? 15_000,
    }),
  );
}

/**
 * 全局状态（用 useState 存，SSR 关闭时等价于单例 ref）。
 * 页面与组件都从这里读写，避免 props 层层传递。
 *
 * 数据不再经过本地 HTTP 服务：网络请求由 Rust 侧转发给官方接口，
 * 记录与配置直接读写本机 JSON（`app/composables/gacha/*`）。
 */
export function useGacha() {
  const accounts = useState<Account[]>("gacha:accounts", () => []);
  const settings = useState<SyncSettings | null>("gacha:settings", () => null);
  const currentUid = useState<string>("gacha:uid", () => "");

  const stats = useState<GachaStats | null>("gacha:stats", () => null);
  const records = useState<RecordsPage>("gacha:records", () => ({ ...EMPTY_RECORDS }));
  const filters = useState<RecordFilters>("gacha:filters", () => ({ categoryId: "", rarity: 0, search: "" }));

  const progress = useState<SyncProgress | null>("gacha:progress", () => null);
  const result = useState<SyncResult | null>("gacha:result", () => null);
  const running = useState<boolean>("gacha:running", () => false);
  const syncError = useState<string | null>("gacha:syncError", () => null);

  const loading = useState<LoadingFlags>("gacha:loading", () => ({ boot: true, stats: false, records: false }));
  const error = useState<string | null>("gacha:error", () => null);
  const ready = useState<boolean>("gacha:ready", () => false);

  const account = computed<Account | null>(
    () => accounts.value.find((item) => item.uid === currentUid.value) ?? null,
  );
  const categories = computed(() => account.value?.categories ?? []);

  const totalPages = computed(() => {
    const size = records.value.pageSize || EMPTY_RECORDS.pageSize;
    return Math.max(1, Math.ceil(records.value.total / size));
  });

  const sixStarRate = computed(() => {
    const current = stats.value;
    if (!current || !current.totalPulls) return 0;
    return current.sixStarCount / current.totalPulls;
  });

  function setFlag<K extends keyof LoadingFlags>(key: K, value: boolean): void {
    loading.value = { ...loading.value, [key]: value };
  }

  function applySyncState(state: SyncTaskState | null): void {
    if (!state) {
      progress.value = null;
      result.value = null;
      running.value = false;
      syncError.value = null;
      return;
    }
    progress.value = state.progress ?? null;
    result.value = state.result ?? null;
    running.value = state.running;
    syncError.value = state.error ?? null;
  }

  async function refreshAccounts(): Promise<void> {
    const stored = await gachaStore.listAccounts();
    accounts.value = stored.map(toPublicAccount);
    settings.value = await gachaStore.getSettings();
    if (!accounts.value.some((item) => item.uid === currentUid.value)) {
      currentUid.value = accounts.value[0]?.uid ?? "";
    }
  }

  async function refreshStats(): Promise<void> {
    if (!currentUid.value) {
      stats.value = null;
      return;
    }
    setFlag("stats", true);
    try {
      const all = await gachaStore.readRecords(currentUid.value);
      stats.value = computeStats(all, filters.value.categoryId || undefined);
    } catch (caught) {
      error.value = toMessage(caught);
    } finally {
      setFlag("stats", false);
    }
  }

  async function refreshRecords(page = records.value.page): Promise<void> {
    if (!currentUid.value) {
      records.value = { ...EMPTY_RECORDS };
      return;
    }
    setFlag("records", true);
    try {
      const all = await gachaStore.readRecords(currentUid.value);
      const filtered = filterRecords(all, {
        ...(filters.value.categoryId ? { categoryId: filters.value.categoryId } : {}),
        ...(filters.value.rarity ? { rarity: filters.value.rarity } : {}),
        ...(filters.value.search ? { search: filters.value.search } : {}),
      });
      const pageSize = EMPTY_RECORDS.pageSize;
      const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
      const current = Math.min(Math.max(page, 1), lastPage);
      records.value = {
        items: filtered.slice((current - 1) * pageSize, current * pageSize),
        total: filtered.length,
        page: current,
        pageSize,
      };
    } catch (caught) {
      error.value = toMessage(caught);
    } finally {
      setFlag("records", false);
    }
  }

  async function refreshSync(): Promise<void> {
    if (!currentUid.value) {
      applySyncState(null);
      return;
    }
    applySyncState(latestTaskState(currentUid.value));
  }

  async function bootstrap(): Promise<void> {
    if (ready.value && accounts.value.length > 0) return;
    setFlag("boot", true);
    error.value = null;
    try {
      await refreshAccounts();
      ready.value = true;
      if (currentUid.value) {
        await Promise.all([refreshStats(), refreshRecords(1), refreshSync()]);
      }
    } catch (caught) {
      error.value = toMessage(caught);
    } finally {
      setFlag("boot", false);
    }
  }

  async function reloadAccount(): Promise<void> {
    await Promise.all([refreshStats(), refreshRecords(1), refreshSync()]);
  }

  async function selectAccount(uid: string): Promise<void> {
    if (uid === currentUid.value) return;
    currentUid.value = uid;
    stats.value = null;
    records.value = { ...EMPTY_RECORDS };
    applySyncState(null);
    await reloadAccount();
  }

  async function setFilter(patch: Partial<RecordFilters>): Promise<void> {
    const next: RecordFilters = { ...filters.value, ...patch };
    const categoryChanged = next.categoryId !== filters.value.categoryId;
    filters.value = next;
    if (categoryChanged) void refreshStats();
    await refreshRecords(1);
  }

  async function goPage(page: number): Promise<void> {
    if (page < 1 || page > totalPages.value) return;
    await refreshRecords(page);
  }

  async function startSync(mode: SyncMode): Promise<void> {
    const uid = currentUid.value;
    if (!uid || running.value) return;
    running.value = true;
    syncError.value = null;
    result.value = null;

    try {
      const stored = await gachaStore.findAccount(uid);
      if (!stored) throw new Error("账号不存在，请重新添加");

      let finished = false;
      await startSyncTask(stored, mode, {
        onUpdate: (state) => {
          progress.value = state.progress;
          result.value = state.result;
          running.value = state.running;
          syncError.value = state.error;
          if (!state.running && !finished) {
            finished = true;
            void refreshAccounts();
            void refreshStats();
            void refreshRecords(1);
          }
        },
      });
    } catch (caught) {
      running.value = false;
      syncError.value = toMessage(caught);
      throw caught;
    }
  }

  async function cancelSync(): Promise<void> {
    if (!currentUid.value) return;
    // 没有在跑的任务时也把页面上的运行标记复位，避免按钮卡在 loading
    if (!cancelSyncTask(currentUid.value)) running.value = false;
  }

  async function probeToken(token: string): Promise<{ bindings: BindingOptionResult[] }> {
    const payload = await gachaStore.readConfig();
    const client = createClient(payload.settings);
    return { bindings: await client.listBindings(token) };
  }

  async function createAccount(payload: {
    token: string;
    uid: string;
    nickName?: string;
    channel?: AccountChannel;
  }): Promise<Account> {
    const current = await gachaStore.readConfig();
    const client = createClient(current.settings);
    const bindings = await client.listBindings(payload.token);
    const binding =
      (payload.uid ? bindings.find((item) => item.uid === payload.uid) : undefined) ??
      bindings.find((item) => item.isDefault) ??
      bindings[0];
    if (!binding) throw new Error("未找到可绑定的角色");

    const existing = await gachaStore.findAccount(binding.uid);
    const account = await gachaStore.upsertAccount({
      uid: binding.uid,
      nickName: payload.nickName?.trim() || binding.nickName,
      channel: payload.channel ?? binding.channel,
      token: payload.token,
      ...(existing ? { recordCount: existing.recordCount, categories: existing.categories } : {}),
    });

    await refreshAccounts();
    currentUid.value = account.uid;
    await reloadAccount();
    return toPublicAccount(account);
  }

  async function removeAccount(uid: string): Promise<void> {
    await gachaStore.deleteAccount(uid);
    if (currentUid.value === uid) {
      currentUid.value = "";
      stats.value = null;
      records.value = { ...EMPTY_RECORDS };
      applySyncState(null);
    }
    await refreshAccounts();
    if (currentUid.value) await reloadAccount();
  }

  async function saveSettings(payload: Partial<SyncSettings>): Promise<SyncSettings> {
    settings.value = await gachaStore.saveSettings(payload);
    return settings.value;
  }

  /** 导出到系统「下载」目录，返回实际写入的路径 */
  async function exportRecords(kind: ExportKind, categoryId?: string): Promise<string> {
    const uid = currentUid.value;
    if (!uid) throw new Error("请先选择账号");

    const all = await gachaStore.readRecords(uid);
    const scoped = categoryId ? all.filter((record) => record.categoryId === categoryId) : all;
    const contents =
      kind === "csv"
        ? toCsv(scoped)
        : toRawJson(uid, scoped, await gachaStore.getSettings());
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fileName =
      kind === "csv" ? `arknights-gacha-${uid}-${stamp}.csv` : `arknights-gacha-${uid}.json`;

    return await invoke<string>("export_file", { fileName, contents });
  }

  return {
    // state
    accounts,
    settings,
    currentUid,
    stats,
    records,
    filters,
    progress,
    result,
    running,
    syncError,
    loading,
    error,
    ready,
    // derived
    account,
    categories,
    totalPages,
    sixStarRate,
    // actions
    bootstrap,
    refreshAccounts,
    refreshStats,
    refreshRecords,
    refreshSync,
    reloadAccount,
    selectAccount,
    setFilter,
    goPage,
    startSync,
    cancelSync,
    probeToken,
    createAccount,
    removeAccount,
    saveSettings,
    exportRecords,
  };
}
