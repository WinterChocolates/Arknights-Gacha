<script setup lang="ts">
import { zh_cn } from "@nuxt/ui/locale";

const gacha = useGacha();

// 首次进入拉一次账号 / 设置
onMounted(() => {
  void gacha.bootstrap();
});
</script>
<template>
  <UApp :locale="zh_cn">
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
