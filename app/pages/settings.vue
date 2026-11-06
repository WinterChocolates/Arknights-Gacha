<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import type { SyncSettings } from "~/types/gacha";

interface FormState {
  pageSize: string;
  delayMinMs: string;
  delayMaxMs: string;
  maxRetries: string;
  requestTimeoutMs: string;
  maxPagesPerCategory: string;
}

const { accounts, settings, account, saveSettings, removeAccount } = useGacha();
const { exporting, exportFile } = useRecordExport();

const toast = useToast();
const busy = ref(false);
const confirmingUid = ref("");
const dataDir = ref("");

onMounted(async () => {
  dataDir.value = await invoke<string>("data_dir").catch(() => "");
});


const form = reactive<FormState>({
  pageSize: "50",
  delayMinMs: "400",
  delayMaxMs: "900",
  maxRetries: "3",
  requestTimeoutMs: "15000",
  maxPagesPerCategory: "400",
});

function fill(current: SyncSettings | null): void {
  if (!current) return;
  form.pageSize = String(current.pageSize);
  form.delayMinMs = String(current.delayMinMs);
  form.delayMaxMs = String(current.delayMaxMs);
  form.maxRetries = String(current.maxRetries);
  form.requestTimeoutMs = String(current.requestTimeoutMs);
  form.maxPagesPerCategory = String(current.maxPagesPerCategory);
}

watch(settings, (value) => fill(value), { immediate: true });

const numberField = (label: string, key: keyof FormState, hint: string, min: number, max: number, step: number) => ({
  label,
  key,
  hint,
  min,
  max,
  step,
});

const fields = [
  numberField("每页条数", "pageSize", "官方接口上限 50", 10, 50, 10),
  numberField("单页重试次数", "maxRetries", "失败后最多重试几次", 0, 6, 1),
  numberField("翻页间隔下限", "delayMinMs", "毫秒，越大越安全", 0, 10_000, 50),
  numberField("翻页间隔上限", "delayMaxMs", "毫秒，需不小于下限", 0, 20_000, 50),
  numberField("单请求超时", "requestTimeoutMs", "毫秒", 3_000, 60_000, 1_000),
  numberField("单卡池翻页上限", "maxPagesPerCategory", "防止异常响应死循环", 10, 2_000, 10),
];

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function save(): Promise<void> {
  busy.value = true;
  try {
    await saveSettings({
      pageSize: toNumber(form.pageSize, 50),
      delayMinMs: toNumber(form.delayMinMs, 400),
      delayMaxMs: toNumber(form.delayMaxMs, 900),
      maxRetries: toNumber(form.maxRetries, 3),
      requestTimeoutMs: toNumber(form.requestTimeoutMs, 15_000),
      maxPagesPerCategory: toNumber(form.maxPagesPerCategory, 400),
    });
    toast.add({ title: "设置已保存", icon: "i-lucide-circle-check", color: "success" });
  } catch (error) {
    toast.add({
      title: "保存失败",
      description: error instanceof Error ? error.message : String(error),
      icon: "i-lucide-triangle-alert",
      color: "error",
    });
  } finally {
    busy.value = false;
  }
}

async function remove(uid: string): Promise<void> {
  if (confirmingUid.value !== uid) {
    confirmingUid.value = uid;
    return;
  }
  confirmingUid.value = "";
  try {
    await removeAccount(uid);
    toast.add({ title: "账号已删除", icon: "i-lucide-trash-2", color: "success" });
  } catch (error) {
    toast.add({
      title: "删除失败",
      description: error instanceof Error ? error.message : String(error),
      icon: "i-lucide-triangle-alert",
      color: "error",
    });
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-lg font-semibold">设置</h1>
      <p class="mt-0.5 text-xs text-muted">翻页间隔越大越安全，官方接口对高频请求比较敏感。</p>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">同步参数</span>
          <UButton color="primary" size="sm" :loading="busy" @click="save">保存设置</UButton>
        </div>
      </template>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField v-for="field in fields" :key="field.key" :label="field.label" :hint="field.hint">
          <UInput
            v-model="form[field.key]"
            type="number"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            class="w-full"
          />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">本机账号</span>
          <span class="text-xs text-muted">{{ accounts.length }} 个</span>
        </div>
      </template>

      <div v-if="!accounts.length" class="py-6 text-center text-sm text-muted">还没有账号。</div>

      <div v-else class="divide-y divide-default">
        <div v-for="item in accounts" :key="item.uid" class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ item.nickName }}</span>
              <UBadge :color="item.channel === 'bilibili' ? 'warning' : 'primary'" variant="subtle" size="sm">
                {{ item.channel === "bilibili" ? "B 服" : "官服" }}
              </UBadge>
              <UBadge v-if="item.uid === account?.uid" color="neutral" variant="subtle" size="sm">当前</UBadge>
            </div>
            <div class="mt-0.5 text-xs text-muted tabular">
              UID {{ item.uid }} · {{ item.recordCount }} 条记录 · 上次同步 {{ formatRelative(item.lastSyncAt) }}
            </div>
          </div>
          <UButton
            :color="confirmingUid === item.uid ? 'error' : 'neutral'"
            variant="soft"
            size="sm"
            icon="i-lucide-trash-2"
            @click="remove(item.uid)"
          >
            {{ confirmingUid === item.uid ? "再次点击确认" : "删除" }}
          </UButton>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <span class="text-sm font-medium">数据导出</span>
      </template>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-lucide-file-spreadsheet"
          color="neutral"
          variant="soft"
          :disabled="!account"
          :loading="exporting === 'csv'"
          @click="exportFile('csv')"
        >
          导出 CSV
        </UButton>
        <UButton
          icon="i-lucide-file-json"
          color="neutral"
          variant="soft"
          :disabled="!account"
          :loading="exporting === 'json'"
          @click="exportFile('json')"
        >
          JSON 备份
        </UButton>
      </div>
      <p class="mt-3 text-xs leading-5 text-muted">
        导出写入系统「下载」目录；数据保存在 exe 同目录的 userData（该目录不可写时退回用户数据目录）：<br />
        <code class="rounded bg-muted px-1 py-0.5">{{ dataDir || "…" }}</code><br />
        <code class="rounded bg-muted px-1 py-0.5">config.json</code> 存账号与同步设置（含 token，只在本机），
        <code class="rounded bg-muted px-1 py-0.5">gachaData/&lt;uid&gt;.json</code> 存寻访记录。
      </p>
    </UCard>
  </div>
</template>
