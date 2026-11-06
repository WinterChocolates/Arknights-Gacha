<script setup lang="ts">
import type { SyncMode, SyncPhase, SyncStatus } from "~/types/gacha";

const {
  accounts,
  currentUid,
  account,
  progress,
  result,
  running,
  syncError,
  selectAccount,
  startSync,
  cancelSync,
  refreshAccounts,
} = useGacha();

const toast = useToast();

const addOpen = ref(false);

const accountItems = computed(() =>
  accounts.value.map((item) => ({
    label: `${item.nickName}${item.channel === "bilibili" ? "（B 服）" : ""} · ${item.uid}`,
    value: item.uid,
  })),
);

// USelect 不接受空字符串作为「无选择」，所以这里用占位值兜底
const selectedAccount = computed({
  get: () => currentUid.value || undefined,
  set: (value: string | undefined) => {
    if (value && value !== currentUid.value) void selectAccount(value);
  },
});

const PHASE_LABEL: Record<SyncPhase, string> = {
  queued: "排队中",
  auth: "登录鹰角账号",
  categories: "读取卡池分类",
  history: "同步寻访记录",
  saving: "写入本地",
  done: "已完成",
  error: "已中断",
};

const STATUS_LABEL: Record<SyncStatus, string> = {
  success: "同步成功",
  partial: "部分成功",
  failed: "同步失败",
};

const STATUS_COLOR: Record<SyncStatus, "success" | "warning" | "error"> = {
  success: "success",
  partial: "warning",
  failed: "error",
};

const percent = computed(() => {
  const current = progress.value;
  if (!current) return 0;
  if (current.phase === "done") return 100;
  if (current.phase === "saving") return 96;
  if (current.totalCategories === 0) return current.phase === "queued" ? 2 : 8;
  const perCategory = 100 / current.totalCategories;
  const done = Math.max(current.categoryIndex - 1, 0) * perCategory;
  const within = Math.min(current.page, 8) / 8;
  return Math.min(99, Math.round(done + perCategory * within * 0.92));
});

const phaseLabel = computed(() => (progress.value ? PHASE_LABEL[progress.value.phase] : ""));

const categoryText = computed(() => {
  const current = progress.value;
  if (!current?.categoryName) return "";
  return `${current.categoryName}（${current.categoryIndex}/${current.totalCategories}）`;
});

const menuItems = computed(() => [
  [
    {
      label: "全量同步（重抓全部历史）",
      icon: "i-lucide-history",
      onSelect: () => void run("full"),
    },
    {
      label: "刷新账号信息",
      icon: "i-lucide-rotate-cw",
      onSelect: () => void refreshAccounts(),
    },
  ],
]);

async function run(mode: SyncMode): Promise<void> {
  try {
    await startSync(mode);
    toast.add({
      title: mode === "full" ? "已开始全量同步" : "已开始增量同步",
      icon: "i-lucide-refresh-cw",
      color: "primary",
    });
  } catch (error) {
    toast.add({
      title: "同步启动失败",
      description: error instanceof Error ? error.message : String(error),
      icon: "i-lucide-triangle-alert",
      color: "error",
    });
  }
}

async function onAdded(): Promise<void> {
  addOpen.value = false;
  toast.add({ title: "账号已添加", icon: "i-lucide-circle-check", color: "success" });
  // 新账号本地没有记录，直接跑一次增量同步把历史拉下来
  await run("incremental");
}
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden bg-default text-default">
    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="shrink-0 border-b border-default bg-default/80 backdrop-blur">
        <div class="flex flex-wrap items-center gap-3 px-5 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <USelect
              v-model="selectedAccount"
              :items="accountItems"
              placeholder="选择账号"
              icon="i-lucide-user-round"
              class="w-64"
              :disabled="accounts.length === 0"
            />
            <UButton icon="i-lucide-plus" color="neutral" variant="soft" @click="addOpen = true">添加账号</UButton>
          </div>

          <div v-if="account" class="hidden items-center gap-2 text-xs text-muted md:flex">
            <UBadge :color="account.channel === 'bilibili' ? 'warning' : 'primary'" variant="subtle" size="sm">
              {{ account.channel === "bilibili" ? "B 服" : "官服" }}
            </UBadge>
            <span class="tabular">{{ account.recordCount }} 条记录</span>
            <span>·</span>
            <span>上次同步 {{ formatRelative(account.lastSyncAt) }}</span>
          </div>

          <div class="ml-auto flex items-center gap-2">
            <UButton
              icon="i-lucide-download"
              color="primary"
              :loading="running"
              :disabled="!account || running"
              @click="run('incremental')"
            >
              增量同步
            </UButton>
            <UDropdownMenu :items="menuItems">
              <UButton
                icon="i-lucide-chevron-down"
                color="neutral"
                variant="soft"
                square
                :disabled="!account"
                aria-label="更多同步选项"
              />
            </UDropdownMenu>
            <UButton v-if="running" icon="i-lucide-square" color="error" variant="soft" @click="void cancelSync()">
              取消
            </UButton>
          </div>
        </div>

        <div v-if="progress || result || syncError" class="px-5 pb-3">
          <UProgress :model-value="percent" color="primary" size="sm" />
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span v-if="progress">{{ phaseLabel }} · {{ progress.message }}</span>
            <span v-if="categoryText">卡池 <strong class="text-default">{{ categoryText }}</strong></span>
            <span v-if="progress?.page">第 <strong class="text-default">{{ progress.page }}</strong> 页</span>
            <span v-if="progress">新增 <strong class="text-default">{{ progress.added }}</strong> 条</span>
            <span v-if="progress?.fetched">已请求 <strong class="text-default">{{ progress.fetched }}</strong> 条</span>

            <template v-if="result">
              <UBadge :color="STATUS_COLOR[result.status]" variant="subtle" size="sm">
                {{ STATUS_LABEL[result.status] }}
              </UBadge>
              <span>本次新增 {{ result.added }} 条 · 耗时 {{ formatDuration(result.durationMs) }}</span>
              <span v-if="result.failedCategories.length">失败卡池：{{ result.failedCategories.join("、") }}</span>
            </template>

            <span v-if="syncError" class="text-error">{{ syncError }}</span>
          </div>
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <slot />
      </main>
    </div>

    <AddAccountModal v-model:open="addOpen" @added="onAdded" />
  </div>
</template>
