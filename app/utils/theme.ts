/**
 * 全局配色口径：与 endfield-gacha 保持一致（绿色主色 + slate / zinc 中性色）。
 * CSS 变量在 app/assets/css/main.css 中定义，这里提供 JS 侧（图表、内联样式）用的同一份色值。
 */

/** 星级 → 颜色，图表与文字共用一套口径 */
export const RARITY_COLORS: Record<number, string> = {
  6: "#ff8904",
  5: "#fdc700",
  4: "#ad46ff",
  3: "#51a2ff",
  2: "#05df72",
  1: "#71717b",
};

export function rarityColor(rarity: number): string {
  return RARITY_COLORS[rarity] ?? "#71717b";
}

/** 图表：次要文字（坐标轴、图例） */
export const CHART_TEXT_MUTED = "#71717b";
/** 图表：强调文字（hover 标签） */
export const CHART_TEXT_STRONG = "#18181b";
/** 图表：扇区分隔色，与页面底色（纯白）一致 */
export const CHART_SURFACE = "#ffffff";
