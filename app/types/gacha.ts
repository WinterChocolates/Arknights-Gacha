/**
 * 页面前端使用的数据契约（仅类型 + 纯常量，不引入任何运行时依赖）。
 */

/** 干员星级（明日方舟目前为 1★ ~ 6★） */
export type Rarity = number;

/** 单条寻访记录（一次十连会被拆成 10 条，共用同一个 gachaTs） */
export interface GachaRecord {
  /** 去重主键：`${gachaTs}|${pos}|${charId}` */
  id: string;
  /** 寻访时间戳（毫秒）。同一批十连内的记录完全一致 */
  gachaTs: number;
  /** 十连内位置，官方接口原样提供（通常 1..10） */
  pos: number;
  charId: string;
  charName: string;
  rarity: Rarity;
  /** 是否为首次获得 */
  isNew: boolean;
  poolId: string;
  poolName: string;
  /** 官方 `gacha/cate` 返回的卡池分类 id */
  categoryId: string;
}

/** 卡池分类 */
export interface GachaPoolCategory {
  id: string;
  name: string;
}

export type AccountChannel = "official" | "bilibili";

export type SyncMode = "incremental" | "full";

export type SyncStatus = "success" | "partial" | "failed";

/** 前端可见的账号信息（不含任何凭证） */
export interface Account {
  uid: string;
  nickName: string;
  channel: AccountChannel;
  createdAt: number;
  updatedAt: number;
  lastSyncAt: number | null;
  lastSyncMode: SyncMode | null;
  lastSyncStatus: SyncStatus | null;
  recordCount: number;
  categories: GachaPoolCategory[];
}

export interface SyncSettings {
  /** 每页条数 */
  pageSize: number;
  /** 翻页间隔下限（毫秒） */
  delayMinMs: number;
  /** 翻页间隔上限（毫秒） */
  delayMaxMs: number;
  /** 单页失败重试次数 */
  maxRetries: number;
  /** 单次请求超时（毫秒） */
  requestTimeoutMs: number;
  /** 单卡池最多翻页数 */
  maxPagesPerCategory: number;
}

/** 落盘的账号信息，含凭证（只写入本机磁盘，不上传任何服务） */
export interface StoredAccount extends Account {
  /** 鹰角账号 token，来自 https://web-api.hypergryph.com/account/info/hg */
  token: string;
  /** uid 级 token，由 binding-api 换取；缓存用于减少登录请求 */
  u8Token?: string;
}

/** 记录查询条件 */
export interface RecordsQuery {
  categoryId?: string;
  rarity?: number;
  search?: string;
}

export type SyncPhase =
  | "queued"
  | "auth"
  | "categories"
  | "history"
  | "saving"
  | "done"
  | "error";

export interface SyncProgress {
  taskId: string;
  uid: string;
  mode: SyncMode;
  phase: SyncPhase;
  categoryId: string | null;
  categoryName: string | null;
  /** 当前处理到第几个卡池（从 1 开始，未开始为 0） */
  categoryIndex: number;
  totalCategories: number;
  /** 当前卡池已翻页数 */
  page: number;
  /** 本次已拉取条数（含重复） */
  fetched: number;
  /** 本次已写入条数 */
  added: number;
  message: string;
  updatedAt: number;
}

export interface SyncCategoryResult {
  id: string;
  name: string;
  pages: number;
  fetched: number;
  added: number;
  status: "success" | "failed";
  error?: string;
}

export interface SyncResult {
  taskId: string;
  uid: string;
  mode: SyncMode;
  status: SyncStatus;
  /** 新增写入的条数 */
  added: number;
  /** 本次请求到的条数（含重复） */
  fetched: number;
  durationMs: number;
  categories: SyncCategoryResult[];
  failedCategories: string[];
  warnings: string[];
  error: string | null;
  finishedAt: number;
}

export interface SyncTaskState {
  progress: SyncProgress;
  result: SyncResult | null;
  running: boolean;
  error: string | null;
}

/** 账号探测（粘贴 token 后换取可绑定角色列表） */
export interface BindingOption {
  uid: string;
  nickName: string;
  channel: AccountChannel;
  isDefault: boolean;
}

export interface RecordsPage {
  items: GachaRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RarityBucket {
  rarity: Rarity;
  count: number;
  /** 占比，0 ~ 1 */
  ratio: number;
}

export interface PoolStats {
  poolId: string;
  poolName: string;
  categoryId: string;
  count: number;
  firstTs: number;
  lastTs: number;
  rarityCounts: Record<string, number>;
}

export interface SixStarEntry {
  record: GachaRecord;
  /** 距上一次 6★ 之间抽了多少抽（首条为自卡池开始以来的抽数） */
  pullsSinceLastSix: number;
}

export interface GachaStats {
  totalPulls: number;
  rarityBuckets: RarityBucket[];
  sixStars: SixStarEntry[];
  sixStarCount: number;
  /** 平均多少抽出一个 6★，无数据时为 null */
  averagePullsPerSixStar: number | null;
  /** 只看 6★ 之间的间隔均值，无数据时为 null */
  averageSixStarGap: number | null;
  /** 当前距离上一个 6★ 已经抽了多少次 */
  pullsSinceLastSixStar: number;
  newCharCount: number;
  poolCount: number;
  pools: PoolStats[];
  firstTs: number | null;
  lastTs: number | null;
  /** 统计所覆盖的卡池分类，undefined 表示全部 */
  categoryId?: string;
}
