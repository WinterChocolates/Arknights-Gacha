import type {
  GachaPoolCategory,
  GachaRecord,
  StoredAccount,
  SyncCategoryResult,
  SyncMode,
  SyncProgress,
  SyncResult,
  SyncSettings,
  SyncStatus,
  SyncTaskState,
} from "~/types/gacha";
import { delay } from "~/utils/gachaCalc";
import { ArknightsApiError, ArknightsClient, type RoleSession } from "./api";
import { AbortedError, HttpClient, HttpError, resetHttpCookies } from "./http";
import { gachaStore, type GachaStore } from "./store";

export interface SyncRunOptions {
  mode: SyncMode;
  taskId: string;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

interface CategoryPullResult {
  result: SyncCategoryResult;
  fatalError: Error | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** token 失效、封禁、取消之类的错误会中断整个同步，而不是只让单个卡池失败 */
function isFatal(error: Error): boolean {
  if (error instanceof AbortedError) return true;
  if (error instanceof HttpError) return error.status === 401 || error.status === 403 || error.status === 0;
  if (error instanceof ArknightsApiError) {
    return /token|登录|失效|过期|绑定角色/i.test(error.message);
  }
  return false;
}

/**
 * 寻访记录同步引擎。
 *
 * 同步流程（与 bhaoo/endfield-gacha 的思路一致，适配明日方舟官方接口）：
 *  1. token 换 app token -> 绑定角色 -> u8 token -> 角色登录
 *  2. `gacha/cate` 拿到卡池分类
 *  3. 每个分类按 `gachaTs + pos` 游标翻页
 *     - 增量同步：遇到本地已有记录即停止（后续页只会更旧），但仍保留该页新增的部分
 *     - 全量同步：一直翻到 `hasMore = false`，用于补齐本地缺失记录
 *  4. 按 `gachaTs|pos|charId` 去重合并落盘
 */
export class SyncEngine {
  private readonly store: GachaStore;
  private readonly client: ArknightsClient;

  constructor(deps: { store?: GachaStore; client?: ArknightsClient } = {}) {
    this.store = deps.store ?? gachaStore;
    this.client = deps.client ?? new ArknightsClient();
  }

  async sync(account: StoredAccount, options: SyncRunOptions): Promise<SyncResult> {
    const startedAt = Date.now();
    const settings = await this.store.getSettings();
    const progress: SyncProgress = {
      taskId: options.taskId,
      uid: account.uid,
      mode: options.mode,
      phase: "queued",
      categoryId: null,
      categoryName: null,
      categoryIndex: 0,
      totalCategories: 0,
      page: 0,
      fetched: 0,
      added: 0,
      message: "同步任务已创建",
      updatedAt: startedAt,
    };
    const emit = (patch: Partial<SyncProgress>) => {
      Object.assign(progress, patch, { updatedAt: Date.now() });
      options.onProgress?.({ ...progress });
    };

    const existing = await this.store.readRecords(account.uid);
    const knownKeys = new Set(existing.map((record) => record.id));
    const collected: GachaRecord[] = [];
    const categoryResults: SyncCategoryResult[] = [];
    const warnings: string[] = [];
    let fatalError: Error | null = null;
    let categories: GachaPoolCategory[] = [];

    emit({ phase: "auth", message: "正在登录鹰角账号…" });

    try {
      const session = await this.client.openSession(account.token, {
        uid: account.uid,
        channel: account.channel,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      emit({ phase: "categories", message: "正在获取卡池分类…" });
      categories = await this.client.fetchCategories(session, options.signal);
      if (categories.length === 0) {
        throw new ArknightsApiError("官方未返回卡池分类，暂时无法同步", -1);
      }
      await this.store.patchAccount(account.uid, {
        nickName: session.nickName || account.nickName,
        u8Token: session.u8Token,
        categories,
      });

      for (const [index, category] of categories.entries()) {
        if (options.signal?.aborted) throw new AbortedError();
        emit({
          phase: "history",
          categoryId: category.id,
          categoryName: category.name,
          categoryIndex: index + 1,
          totalCategories: categories.length,
          page: 0,
          message: `正在同步「${category.name}」…`,
        });

        const pulled = await this.pullCategory({
          session,
          category,
          mode: options.mode,
          settings,
          knownKeys,
          collected,
          categoryIndex: index + 1,
          totalCategories: categories.length,
          emit,
          warnings,
          fetchedBefore: progress.fetched,
          ...(options.signal ? { signal: options.signal } : {}),
        });

        categoryResults.push(pulled.result);
        if (pulled.fatalError) {
          fatalError = pulled.fatalError;
          break;
        }
      }
    } catch (error) {
      fatalError = toError(error);
    }

    const aborted = fatalError instanceof AbortedError;
    const status = this.resolveStatus(fatalError, categoryResults, categories);

    emit({
      phase: fatalError ? "error" : "saving",
      message: fatalError
        ? `同步中断：${fatalError.message}`
        : `正在写入本地记录（新增 ${collected.length} 条）…`,
    });

    let added = 0;
    let total = existing.length;
    try {
      const merged = await this.store.mergeRecords(account.uid, collected);
      added = merged.added;
      total = merged.total;
    } catch (error) {
      fatalError = fatalError ?? toError(error);
      warnings.push(`写入本地记录失败：${toError(error).message}`);
    }

    const finishedAt = Date.now();
    const result: SyncResult = {
      taskId: options.taskId,
      uid: account.uid,
      mode: options.mode,
      status,
      added,
      fetched: progress.fetched,
      durationMs: finishedAt - startedAt,
      categories: categoryResults,
      failedCategories: categoryResults.filter((item) => item.status === "failed").map((item) => item.name),
      warnings,
      error: fatalError && !aborted ? fatalError.message : aborted ? "同步已取消" : null,
      finishedAt,
    };

    await this.store
      .patchAccount(account.uid, {
        categories: categories.length > 0 ? categories : account.categories,
        recordCount: total,
        lastSyncAt: finishedAt,
        lastSyncMode: options.mode,
        lastSyncStatus: status,
      })
      .catch(() => undefined);

    emit({
      phase: fatalError ? "error" : "done",
      added,
      fetched: result.fetched,
      message: this.describeResult(result),
    });

    return result;
  }

  private async pullCategory(input: {
    session: RoleSession;
    category: GachaPoolCategory;
    mode: SyncMode;
    settings: SyncSettings;
    knownKeys: Set<string>;
    collected: GachaRecord[];
    categoryIndex: number;
    totalCategories: number;
    /** 本分类开始前已请求的总条数，用于拼出全局进度 */
    fetchedBefore: number;
    emit: (patch: Partial<SyncProgress>) => void;
    warnings: string[];
    signal?: AbortSignal;
  }): Promise<CategoryPullResult> {
    const { session, category, mode, settings, knownKeys, collected, emit, warnings } = input;
    let pages = 0;
    let fetched = 0;
    let added = 0;
    let cursor: { gachaTs: number; pos: number } | undefined;

    const result: SyncCategoryResult = {
      id: category.id,
      name: category.name,
      pages: 0,
      fetched: 0,
      added: 0,
      status: "success",
    };

    try {
      while (pages < settings.maxPagesPerCategory) {
        if (input.signal?.aborted) throw new AbortedError();
        if (pages > 0) await this.pause(settings);

        const page = await this.client.fetchHistoryPage(session, {
          categoryId: category.id,
          pageSize: settings.pageSize,
          ...(cursor ? { cursor } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });

        pages++;
        fetched += page.raw;
        result.pages = pages;
        result.fetched = fetched;

        if (page.raw === 0) break;
        if (page.records.length === 0) {
          throw new ArknightsApiError(
            `第 ${pages} 页返回 ${page.raw} 条数据但无法解析，可能是官方接口字段变更`,
            -1,
          );
        }

        let hitKnown = false;
        for (const record of page.records) {
          if (knownKeys.has(record.id)) {
            hitKnown = true;
            continue;
          }
          knownKeys.add(record.id);
          collected.push(record);
          added++;
        }

        result.added = added;
        emit({
          page: pages,
          fetched: input.fetchedBefore + fetched,
          added,
          categoryId: category.id,
          categoryName: category.name,
          categoryIndex: input.categoryIndex,
          totalCategories: input.totalCategories,
          message: `「${category.name}」第 ${pages} 页，新增 ${added} 条`,
        });

        const last = page.records[page.records.length - 1]!;
        const nextCursor = { gachaTs: last.gachaTs, pos: last.pos };

        // 增量同步：当前页出现已同步过的记录，后面只会更旧
        if (mode === "incremental" && hitKnown) break;
        if (!page.hasMore) break;
        if (cursor && cursor.gachaTs === nextCursor.gachaTs && cursor.pos === nextCursor.pos) {
          warnings.push(`「${category.name}」游标未推进，已停止翻页`);
          break;
        }
        cursor = nextCursor;
      }

      if (pages >= settings.maxPagesPerCategory) {
        warnings.push(`「${category.name}」达到单池翻页上限 ${settings.maxPagesPerCategory} 页，已停止`);
      }
    } catch (error) {
      const err = toError(error);
      result.status = "failed";
      result.error = err.message;
      if (isFatal(err)) {
        return { result: { ...result, fetched, added }, fatalError: err };
      }
    }

    return { result: { ...result, fetched, added }, fatalError: null };
  }

  private resolveStatus(
    fatalError: Error | null,
    categoryResults: SyncCategoryResult[],
    categories: GachaPoolCategory[],
  ): SyncStatus {
    if (fatalError) {
      const succeeded = categoryResults.filter((item) => item.status === "success").length;
      return succeeded === 0 ? "failed" : "partial";
    }
    const failed = categoryResults.filter((item) => item.status === "failed").length;
    if (categories.length > 0 && categoryResults.length < categories.length) return "partial";
    if (failed === 0) return "success";
    return failed === categoryResults.length ? "failed" : "partial";
  }

  private describeResult(result: SyncResult): string {
    const parts = [`新增 ${result.added} 条记录`];
    if (result.fetched > result.added) parts.push(`（共请求 ${result.fetched} 条，其余已存在）`);
    if (result.failedCategories.length > 0) parts.push(`失败卡池：${result.failedCategories.join("、")}`);
    if (result.error) parts.push(`错误：${result.error}`);
    return parts.join("，");
  }

  private async pause(settings: SyncSettings): Promise<void> {
    const min = Math.max(settings.delayMinMs, 0);
    const max = Math.max(settings.delayMaxMs, min);
    const wait = min + Math.floor(Math.random() * Math.max(max - min, 1));
    if (wait > 0) await delay(wait);
  }
}

// ---- 任务登记（页面刷新后仍能从内存里读到最近一次同步状态）----

const taskStates = new Map<string, SyncTaskState>();
const controllers = new Map<string, AbortController>();

function createTaskId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function latestTaskState(uid: string): SyncTaskState | null {
  return taskStates.get(uid) ?? null;
}


export function cancelSyncTask(uid: string): boolean {
  const controller = controllers.get(uid);
  if (!controller) return false;
  controller.abort();
  return true;
}

export interface StartSyncHandlers {
  onUpdate?: (state: SyncTaskState) => void;
}

/**
 * 启动一次同步：立即返回 taskId，进度通过回调推送（原来是后端 SSE）。
 */
export async function startSyncTask(
  account: StoredAccount,
  mode: SyncMode,
  handlers: StartSyncHandlers = {},
): Promise<{ taskId: string }> {
  if (controllers.has(account.uid)) throw new Error("该账号正在同步中，请稍候");

  const taskId = createTaskId();
  const controller = new AbortController();
  controllers.set(account.uid, controller);

  const state: SyncTaskState = {
    progress: {
      taskId,
      uid: account.uid,
      mode,
      phase: "queued",
      categoryId: null,
      categoryName: null,
      categoryIndex: 0,
      totalCategories: 0,
      page: 0,
      fetched: 0,
      added: 0,
      message: mode === "full" ? "已创建全量同步任务" : "已创建增量同步任务",
      updatedAt: Date.now(),
    },
    result: null,
    running: true,
    error: null,
  };
  taskStates.set(account.uid, state);
  handlers.onUpdate?.({ ...state });

  const settings = await gachaStore.getSettings();
  const engine = new SyncEngine({
    client: new ArknightsClient(
      new HttpClient({ maxRetries: settings.maxRetries, timeoutMs: settings.requestTimeoutMs }),
    ),
  });

  // 每轮同步开始前换一次会话，避免沿用上一个账号的 cookie
  await resetHttpCookies();

  void engine
    .sync(account, {
      mode,
      taskId,
      signal: controller.signal,
      onProgress: (progress) => {
        state.progress = progress;
        state.running = progress.phase !== "done" && progress.phase !== "error";
        handlers.onUpdate?.({ ...state });
      },
    })
    .then((result) => {
      state.result = result;
      state.running = false;
      state.error = result.error;
      handlers.onUpdate?.({ ...state });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      state.running = false;
      state.error = message;
      handlers.onUpdate?.({ ...state });
    })
    .finally(() => {
      controllers.delete(account.uid);
    });

  return { taskId };
}
