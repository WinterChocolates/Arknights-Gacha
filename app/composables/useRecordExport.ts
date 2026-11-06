import type { ExportKind } from "~/composables/useGacha";

/**
 * 导出 CSV / JSON 的统一封装：
 * `useGacha().exportRecords` 只负责生成内容并落盘，这里补齐 loading 状态与 toast 提示，
 * 「寻访记录」和「设置」两个页面直接复用，避免两处重复实现。
 */
export function useRecordExport() {
  const { account, exportRecords } = useGacha();
  const toast = useToast();

  const exporting = ref<ExportKind | "">("");
  const isExporting = computed(() => exporting.value !== "");

  async function exportFile(kind: ExportKind): Promise<void> {
    if (!account.value) return;

    exporting.value = kind;
    try {
      const path = await exportRecords(kind);
      toast.add({
        title: "已导出到系统下载目录",
        description: path,
        icon: "i-lucide-circle-check",
        color: "success",
      });
    } catch (caught) {
      toast.add({
        title: "导出失败",
        description: caught instanceof Error ? caught.message : String(caught),
        icon: "i-lucide-triangle-alert",
        color: "error",
      });
    } finally {
      exporting.value = "";
    }
  }

  return { exporting, isExporting, exportFile };
}
