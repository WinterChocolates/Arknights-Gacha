<script setup lang="ts">
const { stats, loading, account, filters, categories, sixStarRate, setFilter } = useGacha();

const categoryValue = computed({
  get: () => filters.value.categoryId || "all",
  set: (value: string) => void setFilter({ categoryId: value === "all" ? "" : value }),
});

const categoryItems = computed(() => [
  { label: "全部卡池", value: "all" },
  ...categories.value.map((item) => ({ label: item.name, value: item.id })),
]);

const empty = computed(() => !loading.value.stats && (!stats.value || stats.value.totalPulls === 0));

const cards = computed(() => {
  const current = stats.value;
  if (!current) return [];
  return [
    { label: "总抽数", value: formatCount(current.totalPulls), unit: "抽", accent: false },
    { label: "6★ 数量", value: formatCount(current.sixStarCount), unit: "次", accent: true },
    { label: "6★ 出率", value: formatPercent(sixStarRate.value), unit: "", accent: false },
    {
      label: "平均出 6★",
      value: current.averagePullsPerSixStar === null ? "—" : String(current.averagePullsPerSixStar),
      unit: current.averagePullsPerSixStar === null ? "" : "抽",
      accent: false,
    },
    { label: "当前垫抽", value: formatCount(current.pullsSinceLastSixStar), unit: "抽", accent: false },
    { label: "新干员", value: formatCount(current.newCharCount), unit: "位", accent: false },
    { label: "卡池数", value: formatCount(current.poolCount), unit: "个", accent: false },
  ];
});

const latestSixStars = computed(() => stats.value?.sixStars.slice(0, 12) ?? []);

const rarityOption = computed(() => {
  const buckets = stats.value?.rarityBuckets ?? [];
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} 次 ({d}%)" },
    legend: {
      orient: "vertical",
      left: "left",
      top: "middle",
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: CHART_TEXT_MUTED, fontSize: 12 },
    },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["60%", "50%"],
        avoidLabelOverlap: false,
        itemStyle: { borderColor: CHART_SURFACE, borderWidth: 2, borderRadius: 10 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 600, color: CHART_TEXT_STRONG, formatter: "{b}\n{c}" } },
        data: buckets.map((bucket) => ({
          name: `${bucket.rarity}★`,
          value: bucket.count,
          itemStyle: { color: rarityColor(bucket.rarity) },
        })),
      },
    ],
  };
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">抽卡统计</h1>
        <p class="mt-0.5 text-xs text-muted">
          <template v-if="stats?.lastTs">截至 {{ formatDateTime(stats.lastTs) }}</template>
          <template v-else>尚未同步任何记录</template>
        </p>
      </div>
      <USelect v-model="categoryValue" :items="categoryItems" icon="i-lucide-layers" class="w-56" />
    </div>

    <UAlert
      v-if="!account"
      color="neutral"
      variant="subtle"
      icon="i-lucide-user-round-plus"
      title="还没有账号"
      description="点击右上角「添加账号」，粘贴鹰角账号 token 即可开始同步。"
    />

    <div v-else-if="empty" class="flex flex-col items-center justify-center gap-2 rounded-xl border border-default bg-elevated/20 py-16 text-muted">
      <UIcon name="i-lucide-database" class="size-8" />
      <p class="text-sm">还没有记录，先做一次同步吧。</p>
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <UCard v-for="card in cards" :key="card.label" :ui="{ body: 'p-4' }">
          <div class="text-xs text-muted">{{ card.label }}</div>
          <div class="mt-1 flex items-baseline gap-1">
            <span class="tabular text-xl font-semibold" :class="card.accent ? 'text-(--ark-six)' : ''">
              {{ card.value }}
            </span>
            <span v-if="card.unit" class="text-xs text-muted">{{ card.unit }}</span>
          </div>
        </UCard>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">星级分布</span>
              <span class="text-xs text-muted">共 {{ formatCount(stats?.totalPulls ?? 0) }} 抽</span>
            </div>
          </template>
          <!-- vue-echarts 的宿主样式是未分层 CSS，height:100% 会压过工具类高度，
               必须套一层固定高度容器，组件本身只负责撑满 -->
          <div class="h-64 w-full">
            <VChart :option="rarityOption" autoresize class="h-full w-full" />
          </div>
        </UCard>

        <UCard v-if="latestSixStars.length">
          <template #header>
            <span class="text-sm font-medium">最近的 6★</span>
          </template>
          <div class="grid gap-2 sm:grid-cols-2">
            <div
              v-for="entry in latestSixStars"
              :key="entry.record.id"
              class="rounded-lg border border-default bg-elevated/30 p-3"
            >
              <div class="flex items-center justify-between">
                <span class="font-medium text-(--ark-six)">{{ entry.record.charName }}</span>
                <UBadge v-if="entry.record.isNew" color="success" variant="subtle" size="sm">New</UBadge>
              </div>
              <div class="mt-1 text-xs text-muted">
                {{ entry.pullsSinceLastSix }} 抽 · {{ formatDateTime(entry.record.gachaTs) }}
              </div>
              <div class="mt-0.5 truncate text-xs text-muted">{{ entry.record.poolName }}</div>
            </div>
          </div>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <span class="text-sm font-medium">卡池明细</span>
        </template>
        <div class="-mx-4 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-muted">
              <tr class="border-b border-default">
                <th class="px-4 py-2 text-left font-medium">卡池</th>
                <th class="px-4 py-2 text-right font-medium">抽数</th>
                <th class="px-4 py-2 text-right font-medium">6★</th>
                <th class="px-4 py-2 text-right font-medium">6★ 率</th>
                <th class="px-4 py-2 text-right font-medium">最近一抽</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="pool in (stats?.pools ?? []).slice(0, 15)"
                :key="pool.poolId || pool.poolName"
                class="border-b border-default/60 last:border-0"
              >
                <td class="max-w-[18rem] truncate px-4 py-2">{{ pool.poolName }}</td>
                <td class="tabular px-4 py-2 text-right">{{ pool.count }}</td>
                <td class="tabular px-4 py-2 text-right text-(--ark-six)">{{ pool.rarityCounts["6"] ?? 0 }}</td>
                <td class="tabular px-4 py-2 text-right text-muted">
                  {{ pool.count ? formatPercent((pool.rarityCounts["6"] ?? 0) / pool.count) : "—" }}
                </td>
                <td class="px-4 py-2 text-right text-muted">{{ formatDateTime(pool.lastTs) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>
  </div>
</template>
