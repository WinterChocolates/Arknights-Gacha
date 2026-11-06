<script setup lang="ts">
const { account, records, filters, categories, loading, totalPages, setFilter, goPage } = useGacha();
const { exporting, exportFile } = useRecordExport();

const categoryValue = computed({
  get: () => filters.value.categoryId || "all",
  set: (value: string) => void setFilter({ categoryId: value === "all" ? "" : value }),
});

const rarityValue = computed({
  get: () => String(filters.value.rarity || "0"),
  set: (value: string) => void setFilter({ rarity: Number(value) || 0 }),
});

const searchValue = computed({
  get: () => filters.value.search,
  set: (value: string) => {
    filters.value = { ...filters.value, search: value };
    queueSearch(value);
  },
});

const pageValue = computed({
  get: () => records.value.page,
  set: (value: number) => void goPage(value),
});

const categoryItems = computed(() => [
  { label: "全部卡池", value: "all" },
  ...categories.value.map((item) => ({ label: item.name, value: item.id })),
]);

/** 星级筛选：从最高星往下排，避免和 MAX_RARITY 各写一份口径 */
const rarityItems = [
  { label: "全部星级", value: "0" },
  ...Array.from({ length: MAX_RARITY - 2 }, (_, index) => {
    const rarity = MAX_RARITY - index;
    return { label: `${rarity}★`, value: String(rarity) };
  }),
];

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function queueSearch(value: string): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void setFilter({ search: value });
  }, 320);
}

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

</script>

<template>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">寻访记录</h1>
        <p class="mt-0.5 text-xs text-muted">共 {{ formatCount(records.total) }} 条 · 第 {{ records.page }} / {{ totalPages }} 页</p>
      </div>
      <div class="flex items-center gap-2">
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
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <USelect v-model="categoryValue" :items="categoryItems" icon="i-lucide-layers" class="w-56" />
      <USelect v-model="rarityValue" :items="rarityItems" icon="i-lucide-star" class="w-36" />
      <UInput v-model="searchValue" name="search" icon="i-lucide-search" placeholder="搜索干员或卡池…" class="w-64" />
    </div>

    <UCard :ui="{ body: 'p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-xs text-muted">
            <tr class="border-b border-default">
              <th class="px-4 py-2.5 text-left font-medium">时间</th>
              <th class="px-4 py-2.5 text-left font-medium">卡池</th>
              <th class="px-4 py-2.5 text-left font-medium">干员</th>
              <th class="px-4 py-2.5 text-left font-medium">星级</th>
              <th class="px-4 py-2.5 text-left font-medium">首次获得</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="record in records.items"
              :key="record.id"
              class="border-b border-default/60 last:border-0 hover:bg-elevated/40"
            >
              <td class="tabular whitespace-nowrap px-4 py-2 text-muted">{{ formatDateTime(record.gachaTs) }}</td>
              <td class="max-w-[16rem] truncate px-4 py-2">{{ record.poolName }}</td>
              <td class="px-4 py-2" :class="record.rarity >= 6 ? 'font-medium text-(--ark-six)' : ''">
                {{ record.charName }}
              </td>
              <td class="px-4 py-2">
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  class="tabular"
                  :style="{ color: rarityColor(record.rarity) }"
                >
                  {{ record.rarity }}★
                </UBadge>
              </td>
              <td class="px-4 py-2">
                <UBadge v-if="record.isNew" color="success" variant="subtle" size="sm">New</UBadge>
                <span v-else class="text-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!records.items.length" class="flex flex-col items-center justify-center gap-2 py-16 text-muted">
        <UIcon name="i-lucide-search-x" class="size-8" />
        <p class="text-sm">{{ loading.records ? "加载中…" : "没有符合条件的记录，先同步一次？" }}</p>
      </div>
    </UCard>

    <div class="flex items-center justify-between">
      <span class="text-xs text-muted">每页 {{ records.pageSize }} 条</span>
      <UPagination v-model:page="pageValue" :total="records.total" :items-per-page="records.pageSize" :disabled="loading.records" />
    </div>
  </div>
</template>
