import type { AccountChannel, GachaPoolCategory, GachaRecord } from "~/types/gacha";
import { normalizeRecord, pickBoolean, pickString } from "~/utils/gachaCalc";
import { HttpClient } from "./http";

/**
 * 明日方舟官方接口地址与常量。
 *
 * 官方改版后的完整调用链：
 *   GET  https://ak.hypergryph.com/user                       -> 拿 session cookie
 *   POST https://as.hypergryph.com/user/oauth2/v2/grant        -> app token
 *   GET  https://binding-api-account-prod.hypergryph.com/account/binding/v1/binding_list
 *                                                              -> 绑定角色列表（含 uid）
 *   POST https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid
 *                                                              -> uid 级 token
 *   POST https://ak.hypergryph.com/user/api/role/login         -> 建立角色会话
 *   GET  https://ak.hypergryph.com/user/api/inquiry/gacha/cate -> 卡池分类
 *   GET  https://ak.hypergryph.com/user/api/inquiry/gacha/history
 *                                                              -> 游标分页的寻访记录
 */
export const ENDPOINTS = {
  csrfPage: "https://ak.hypergryph.com/user",
  grant: "https://as.hypergryph.com/user/oauth2/v2/grant",
  bindingList: "https://binding-api-account-prod.hypergryph.com/account/binding/v1/binding_list",
  u8TokenByUid: "https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid",
  roleLogin: "https://ak.hypergryph.com/user/api/role/login",
  gachaCate: "https://ak.hypergryph.com/user/api/inquiry/gacha/cate",
  gachaHistory: "https://ak.hypergryph.com/user/api/inquiry/gacha/history",
} as const;

/** 鹰角 App 的 appCode（与 ak.hypergryph.com 网页端一致） */
export const APP_CODE = "be36d44aa36bfb5b";

/** binding_list 里明日方舟的 appCode */
export const BINDING_APP_CODE = "arknights";
export const BINDING_APP_CODE_BILIBILI = "arknights_bilibili";

/** 官方单页上限 */
export const MAX_PAGE_SIZE = 50;

const REFERER = "https://ak.hypergryph.com/user/inquiryGacha";

/** 官方统一响应包装 */
interface ApiEnvelope<T> {
  code: number;
  msg?: string;
  message?: string;
  data: T;
}

interface BindingEntry {
  uid: string;
  nickName: string;
  isDefault: boolean;
  channelMasterId: string;
  appCode: string;
}

export interface RoleSession {
  uid: string;
  nickName: string;
  channel: AccountChannel;
  /** 原始账号 token */
  token: string;
  /** uid 级 token */
  u8Token: string;
}

export interface BindingOptionResult {
  uid: string;
  nickName: string;
  channel: AccountChannel;
  isDefault: boolean;
}

export interface HistoryPage {
  records: GachaRecord[];
  hasMore: boolean;
  raw: number;
}

const TOKEN_HINT = "token 可能已失效，请重新登录 https://ak.hypergryph.com 后复制最新 token";

export class ArknightsApiError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "ArknightsApiError";
    this.code = code;
  }
}

function isTokenError(code: number, message: string): boolean {
  if ([1001, 1002, 1003, 1004, 1010, 1011, 1012, 400, 401, 403].includes(code)) return true;
  return /token|登录|失效|过期|unauthor/i.test(message);
}

function resolveChannel(entry: BindingEntry): AccountChannel {
  if (entry.appCode === BINDING_APP_CODE_BILIBILI) return "bilibili";
  if (String(entry.channelMasterId).trim() === "2") return "bilibili";
  return "official";
}

/**
 * 明日方舟寻访记录客户端：
 * 负责 token 登录链路、卡池分类，以及游标分页的历史记录拉取。
 */
export class ArknightsClient {
  readonly http: HttpClient;

  constructor(http: HttpClient = new HttpClient()) {
    this.http = http;
  }

  /** 只换取绑定角色列表，用于「粘贴 token -> 选择角色」的探测流程 */
  async listBindings(token: string, signal?: AbortSignal): Promise<BindingOptionResult[]> {
    const normalized = token.trim();
    if (!normalized) throw new ArknightsApiError("请先填写 token", -1);

    await this.openCsrfCookie(signal);
    const appToken = await this.grantAppToken(normalized, signal);
    const entries = await this.fetchBindingEntries(appToken, signal);

    if (entries.length === 0) {
      throw new ArknightsApiError(
        "该 token 下没有找到明日方舟角色，请先在 https://user.hypergryph.com/bindCharacters 绑定角色并设置默认角色",
        -1,
      );
    }

    return entries.map((entry) => ({
      uid: entry.uid,
      nickName: entry.nickName,
      channel: resolveChannel(entry),
      isDefault: entry.isDefault,
    }));
  }

  /** 完整登录：换取 u8 token 并建立角色会话 */
  async openSession(
    token: string,
    options: { uid?: string; channel?: AccountChannel; signal?: AbortSignal } = {},
  ): Promise<RoleSession> {
    const normalized = token.trim();
    if (!normalized) throw new ArknightsApiError("请先填写 token", -1);

    await this.openCsrfCookie(options.signal);
    const appToken = await this.grantAppToken(normalized, options.signal);
    const entries = await this.fetchBindingEntries(appToken, options.signal);
    if (entries.length === 0) {
      throw new ArknightsApiError(
        "该 token 下没有找到明日方舟角色，请先在 https://user.hypergryph.com/bindCharacters 绑定角色",
        -1,
      );
    }

    const target =
      (options.uid ? entries.find((entry) => entry.uid === options.uid) : undefined) ??
      entries.find((entry) => entry.isDefault) ??
      entries[0]!;

    const u8Token = await this.exchangeU8Token(appToken, target.uid, options.signal);
    await this.roleLogin(u8Token, options.signal);

    return {
      uid: target.uid,
      nickName: target.nickName || `博士 ${target.uid}`,
      channel: options.channel ?? resolveChannel(target),
      token: normalized,
      u8Token,
    };
  }

  async fetchCategories(session: RoleSession, signal?: AbortSignal): Promise<GachaPoolCategory[]> {
    const json = await this.http.getJson<ApiEnvelope<unknown>>(
      ENDPOINTS.gachaCate,
      { "x-role-token": session.u8Token, referer: REFERER },
      signal,
    );
    this.assertOk(json, "获取卡池分类失败");

    const data = json.data;
    const list = Array.isArray(data) ? data : ((data as { list?: unknown[] } | null)?.list ?? []);
    const categories: GachaPoolCategory[] = [];

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const source = item as Record<string, unknown>;
      const id = pickString(source, ["id", "cateId", "category", "categoryId", "poolType"]);
      if (!id) continue;
      const name = pickString(source, ["name", "cateName", "categoryName", "label", "title"]) || id;
      if (!categories.some((category) => category.id === id)) categories.push({ id, name });
    }

    if (categories.length === 0) {
      // 官方接口若只返回字符串数组，也照样接受
      for (const item of list) {
        if (typeof item === "string" && item.trim()) {
          categories.push({ id: item.trim(), name: item.trim() });
        }
      }
    }

    return categories;
  }

  /**
   * 拉取一页寻访记录。
   * 游标为上一页最后一条记录的 `gachaTs + pos`，官方以这两个值做 keyset 分页。
   */
  async fetchHistoryPage(
    session: RoleSession,
    query: {
      categoryId: string;
      pageSize: number;
      cursor?: { gachaTs: number; pos: number };
      signal?: AbortSignal;
    },
  ): Promise<HistoryPage> {
    const size = Math.min(Math.max(Math.trunc(query.pageSize) || MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const params = new URLSearchParams({
      uid: session.uid,
      category: query.categoryId,
      size: String(size),
    });
    if (query.cursor) {
      params.set("gachaTs", String(query.cursor.gachaTs));
      params.set("pos", String(query.cursor.pos));
    }

    const json = await this.http.getJson<ApiEnvelope<{ list?: unknown[]; hasMore?: boolean }>>(
      `${ENDPOINTS.gachaHistory}?${params.toString()}`,
      { "x-role-token": session.u8Token, referer: REFERER },
      query.signal,
    );
    this.assertOk(json, "获取寻访记录失败");

    const data = json.data;
    const list = Array.isArray(data?.list) ? data.list : [];
    const records: GachaRecord[] = [];
    for (const item of list) {
      const record = normalizeRecord(item, query.categoryId);
      if (record) records.push(record);
    }

    const hasMore = typeof data?.hasMore === "boolean" ? data.hasMore : records.length >= size;
    return { records, hasMore, raw: list.length };
  }

  /**
   * 业务 code 校验：`code === 0` 视为成功。
   * 读数据的接口还要求 `data` 非空；角色登录这类成功时 `data` 就是 null 的接口传 `requireData: false`。
   */
  private assertOk(json: ApiEnvelope<unknown>, fallback: string, requireData = true): void {
    const code = typeof json?.code === "number" ? json.code : 0;
    const hasData = json?.data !== null && json?.data !== undefined;
    if (code === 0 && (!requireData || hasData)) return;

    const message = String(json?.msg || json?.message || "").trim();
    if (code === 0) throw new ArknightsApiError(fallback, 0);
    const hint = isTokenError(code, message) ? `（${TOKEN_HINT}）` : "";
    throw new ArknightsApiError(`[${code}] ${message || fallback}${hint}`, code);
  }

  private async openCsrfCookie(signal?: AbortSignal): Promise<void> {
    try {
      await this.http.request(ENDPOINTS.csrfPage, {
        method: "GET",
        headers: { referer: "https://ak.hypergryph.com/", accept: "text/html,application/json" },
        ...(signal ? { signal } : {}),
      });
    } catch {
      // cookie 只影响风控，拿不到也继续尝试后续请求
    }
  }

  private async grantAppToken(token: string, signal?: AbortSignal): Promise<string> {
    const json = await this.http.postJson<ApiEnvelope<{ token?: string } | null>>(
      ENDPOINTS.grant,
      { token, appCode: APP_CODE, type: 1 },
      { origin: "https://ak.hypergryph.com", referer: "https://ak.hypergryph.com/" },
      signal,
    );
    this.assertOk(json, "登录凭证校验失败");
    const appToken = json.data?.token?.trim();
    if (!appToken) throw new ArknightsApiError("登录凭证校验失败：未返回 app token", -1);
    return appToken;
  }

  private async fetchBindingEntries(appToken: string, signal?: AbortSignal): Promise<BindingEntry[]> {
    const entries: BindingEntry[] = [];

    for (const appCode of [BINDING_APP_CODE, BINDING_APP_CODE_BILIBILI]) {
      const params = new URLSearchParams({ token: appToken, appCode });
      const json = await this.http.getJson<ApiEnvelope<{ list?: unknown[] }>>(
        `${ENDPOINTS.bindingList}?${params.toString()}`,
        { referer: "https://ak.hypergryph.com/" },
        signal,
      );
      this.assertOk(json, "获取绑定角色失败");

      const list = Array.isArray(json.data?.list) ? json.data.list : [];
      for (const app of list) {
        if (!app || typeof app !== "object") continue;
        const source = app as Record<string, unknown>;
        const bindingList = Array.isArray(source.bindingList)
          ? source.bindingList
          : Array.isArray(source.binding_list)
            ? (source.binding_list as unknown[])
            : [];

        for (const raw of bindingList) {
          if (!raw || typeof raw !== "object") continue;
          const binding = raw as Record<string, unknown>;
          const uid = pickString(binding, ["uid", "playerUid", "player_uid"]);
          if (!uid) continue;
          if (entries.some((entry) => entry.uid === uid)) continue;
          entries.push({
            uid,
            nickName:
              pickString(binding, ["nickName", "nick_name", "nickname", "name"]) ||
              pickString(source, ["nickName", "nick_name"]),
            isDefault: pickBoolean(binding, ["isDefault", "is_default"]),
            channelMasterId: pickString(binding, ["channelMasterId", "channel_master_id"]),
            appCode,
          });
        }
      }

      if (entries.length > 0) break;
    }

    return entries;
  }

  private async exchangeU8Token(appToken: string, uid: string, signal?: AbortSignal): Promise<string> {
    const json = await this.http.postJson<ApiEnvelope<{ token?: string } | null>>(
      ENDPOINTS.u8TokenByUid,
      { token: appToken, uid },
      { referer: "https://ak.hypergryph.com/" },
      signal,
    );
    this.assertOk(json, "换取角色 token 失败");
    const u8Token = json.data?.token?.trim();
    if (!u8Token) throw new ArknightsApiError("换取角色 token 失败：未返回 u8 token", -1);
    return u8Token;
  }

  private async roleLogin(u8Token: string, signal?: AbortSignal): Promise<void> {
    const json = await this.http.postJson<ApiEnvelope<unknown>>(
      ENDPOINTS.roleLogin,
      { token: u8Token, source_from: "", share_type: "", share_by: "" },
      { origin: "https://ak.hypergryph.com", referer: REFERER },
      signal,
    );
    // 角色登录成功时 data 可能为 null，只校验 code
    this.assertOk(json, "角色登录失败", false);
  }
}

