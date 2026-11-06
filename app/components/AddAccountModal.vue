<script setup lang="ts">
import type { BindingOption } from "~/types/gacha";

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ added: [] }>();

const { probeToken, createAccount } = useGacha();

const token = ref("");
const stage = ref<"token" | "pick">("token");
const bindings = ref<BindingOption[]>([]);
const selectedUid = ref("");
const busy = ref(false);
const error = ref("");

watch(open, (value) => {
  if (!value) return;
  token.value = "";
  stage.value = "token";
  bindings.value = [];
  selectedUid.value = "";
  busy.value = false;
  error.value = "";
});

const bindingItems = computed(() =>
  bindings.value.map((item) => ({
    label: `${item.nickName} · UID ${item.uid} · ${item.channel === "bilibili" ? "B 服" : "官服"}${
      item.isDefault ? " · 默认" : ""
    }`,
    value: item.uid,
  })),
);

async function probe(): Promise<void> {
  error.value = "";
  const value = token.value.trim();
  if (!value) {
    error.value = "请先粘贴账号 token";
    return;
  }

  busy.value = true;
  try {
    const payload = await probeToken(value);
    bindings.value = payload.bindings;
    selectedUid.value = (payload.bindings.find((item) => item.isDefault) ?? payload.bindings[0])?.uid ?? "";
    stage.value = "pick";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

async function confirm(): Promise<void> {
  const binding = bindings.value.find((item) => item.uid === selectedUid.value);
  if (!binding) {
    error.value = "请选择一个角色";
    return;
  }

  busy.value = true;
  error.value = "";
  try {
    await createAccount({
      token: token.value.trim(),
      uid: binding.uid,
      nickName: binding.nickName,
      channel: binding.channel,
    });
    emit("added");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" title="添加账号" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          token 只会写入本机数据目录，不会上传到任何第三方服务。
        </p>

        <template v-if="stage === 'token'">
          <div class="rounded-lg border border-default bg-elevated/40 p-3 text-sm leading-6">
            <div>
              1. 浏览器登录
              <ULink
                to="https://web-api.hypergryph.com/account/info/hg"
                target="_blank"
                class="text-primary underline-offset-4 hover:underline"
              >
                web-api.hypergryph.com/account/info/hg
              </ULink>
            </div>
            <div>2. 复制页面里的 <code class="rounded bg-muted px-1 py-0.5 text-xs">"token"</code> 值</div>
            <div>
              3. 确认账号已绑定明日方舟角色：
              <ULink
                to="https://user.hypergryph.com/bindCharacters"
                target="_blank"
                class="text-primary underline-offset-4 hover:underline"
              >
                user.hypergryph.com/bindCharacters
              </ULink>
            </div>
          </div>

          <UFormField label="账号 token">
            <UTextarea v-model="token" :rows="4" placeholder="粘贴 token…" spellcheck="false" class="w-full font-mono text-xs" />
          </UFormField>
        </template>

        <template v-else>
          <p class="text-sm text-muted">检测到以下角色，选择要同步的那一个：</p>
          <URadioGroup v-model="selectedUid" :items="bindingItems" />
        </template>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <template v-if="stage === 'token'">
          <UButton color="neutral" variant="ghost" @click="open = false">取消</UButton>
          <UButton color="primary" :loading="busy" :disabled="!token.trim()" @click="probe">
            {{ busy ? "正在验证…" : "验证并获取角色" }}
          </UButton>
        </template>
        <template v-else>
          <UButton color="neutral" variant="ghost" @click="stage = 'token'">上一步</UButton>
          <UButton color="primary" :loading="busy" :disabled="!selectedUid" @click="confirm">
            {{ busy ? "正在添加…" : "添加并同步" }}
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
