import type {
  GachaRecord,
  GachaStats,
  PoolStats,
  RarityBucket,
  SixStarEntry,
} from "~/types/gacha";
import { sortRecordsAsc } from "~/utils/gachaCalc";

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * 统计口径（与官方寻访页一致，不做卡池概率推断）：
 * - 每一条记录计 1 抽
 * - `pullsSinceLastSix` 表示「出这个 6★ 之前垫了多少抽」
 * - 平均值 = 总抽数 / 6★ 数量
 */
export function computeStats(records: GachaRecord[], categoryId?: string): GachaStats {
  const scoped = categoryId ? records.filter((record) => record.categoryId === categoryId) : records;
  const asc = sortRecordsAsc(scoped);

  const rarityCount = new Map<number, number>();
  const pools = new Map<string, PoolStats>();
  const sixStarsAsc: SixStarEntry[] = [];
  let counter = 0;
  let newCharCount = 0;

  for (const record of asc) {
    counter++;
    rarityCount.set(record.rarity, (rarityCount.get(record.rarity) ?? 0) + 1);
    if (record.isNew) newCharCount++;

    const poolKey = record.poolId || record.poolName;
    const pool = pools.get(poolKey);
    if (pool) {
      pool.count++;
      pool.rarityCounts[String(record.rarity)] = (pool.rarityCounts[String(record.rarity)] ?? 0) + 1;
      pool.firstTs = Math.min(pool.firstTs, record.gachaTs);
      pool.lastTs = Math.max(pool.lastTs, record.gachaTs);
    } else {
      pools.set(poolKey, {
        poolId: record.poolId,
        poolName: record.poolName,
        categoryId: record.categoryId,
        count: 1,
        firstTs: record.gachaTs,
        lastTs: record.gachaTs,
        rarityCounts: { [String(record.rarity)]: 1 },
      });
    }

    if (record.rarity >= 6) {
      sixStarsAsc.push({
        record,
        pullsSinceLastSix: counter,
      });
      counter = 0;
    }
  }

  const totalPulls = asc.length;
  const sixStarCount = sixStarsAsc.length;
  const gaps = sixStarsAsc.slice(1).map((entry) => entry.pullsSinceLastSix);
  const averageSixStarGap = gaps.length
    ? round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length, 2)
    : null;

  const rarityBuckets: RarityBucket[] = [...rarityCount.keys()]
    .sort((a, b) => b - a)
    .map((rarity) => {
      const count = rarityCount.get(rarity) ?? 0;
      return { rarity, count, ratio: totalPulls ? round(count / totalPulls, 4) : 0 };
    });

  return {
    totalPulls,
    rarityBuckets,
    sixStars: [...sixStarsAsc].reverse(),
    sixStarCount,
    averagePullsPerSixStar: sixStarCount ? round(totalPulls / sixStarCount, 2) : null,
    averageSixStarGap,
    pullsSinceLastSixStar: counter,
    newCharCount,
    poolCount: pools.size,
    pools: [...pools.values()].sort((a, b) => b.lastTs - a.lastTs),
    firstTs: asc.length > 0 ? asc[0]!.gachaTs : null,
    lastTs: asc.length > 0 ? asc[asc.length - 1]!.gachaTs : null,
    ...(categoryId ? { categoryId } : {}),
  };
}
