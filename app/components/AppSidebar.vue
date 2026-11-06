<script setup lang="ts">
const route = useRoute();

const items = [
  { label: "抽卡统计", icon: "i-lucide-chart-pie", to: "/" },
  { label: "寻访记录", icon: "i-lucide-scroll-text", to: "/records" },
  { label: "设置", icon: "i-lucide-settings", to: "/settings" },
];

const isActive = (to: string): boolean => route.path === to;
</script>

<template>
  <aside class="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-default bg-default py-4">
    <UTooltip text="明日方舟寻访记录" placement="right">
      <div
        class="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25"
      >
        <UIcon name="i-lucide-sparkles" class="size-5" />
      </div>
    </UTooltip>

    <UTooltip v-for="item in items" :key="item.to" :text="item.label" placement="right">
      <UButton
        :to="item.to"
        :icon="item.icon"
        :variant="isActive(item.to) ? 'soft' : 'ghost'"
        :color="isActive(item.to) ? 'primary' : 'neutral'"
        size="lg"
        square
        :aria-label="item.label"
      />
    </UTooltip>

    <div class="mt-auto flex flex-col items-center gap-1">
      <UTooltip text="星級口径：1★ ~ 6★" placement="right">
        <UIcon name="i-lucide-info" class="size-4 text-muted" />
      </UTooltip>
    </div>
  </aside>
</template>
