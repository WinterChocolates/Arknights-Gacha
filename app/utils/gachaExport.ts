import type { GachaRecord, SyncSettings } from "~/types/gacha";
import { formatDateTimeSeconds } from "~/utils/format";

const CSV_HEADER = ["时间", "卡池", "分类", "干员", "星级", "首次获得", "记录键"];

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 导出 CSV（带 BOM，Excel 直接双击不乱码） */
export function toCsv(records: GachaRecord[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const record of records) {
    lines.push(
      [
        formatDateTimeSeconds(record.gachaTs),
        record.poolName,
        record.categoryId,
        record.charName,
        record.rarity,
        record.isNew ? "是" : "否",
        record.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 原始 JSON 备份，便于用户自行迁移/分析 */
export function toRawJson(uid: string, records: GachaRecord[], settings: SyncSettings): string {
  return `${JSON.stringify(
    {
      format: "arknights-gacha/v1",
      uid,
      exportedAt: new Date().toISOString(),
      settings,
      records,
    },
    null,
    2,
  )}\n`;
}
