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
 * - 垫抽按「卡池分类」独立累计：与游戏保底机制一致，限定/常驻/中坚等分类之间的垫抽互不共享
 * - `pullsSinceLastSix` 表示「出这个 6★ 之前，在该 6★ 所属分类里垫了多少抽」（首条为该分类开始以来的抽数）
 * - 平均值 = 总抽数 / 6★ 数量
 */
export function computeStats(records: GachaRecord[], categoryId?: string): GachaStats {
  const scoped = categoryId ? records.filter((record) => record.categoryId === categoryId) : records;
  const asc = sortRecordsAsc(scoped);

  const rarityCount = new Map<number, number>();
  const pools = new Map<string, PoolStats>();
  const sixStarsAsc: SixStarEntry[] = [];
  // 每个卡池分类一个独立计数器；最近一次抽卡所在分类的计数即「当前垫抽」
  const counters = new Map<string, number>();
  let lastCategoryId: string | null = null;
  let newCharCount = 0;

  for (const record of asc) {
    const bucketKey = record.categoryId || "";
    lastCategoryId = bucketKey;
    const count = (counters.get(bucketKey) ?? 0) + 1;
    counters.set(bucketKey, count);
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
        pullsSinceLastSix: count,
      });
      counters.set(bucketKey, 0);
    }
  }

  const totalPulls = asc.length;
  const sixStarCount = sixStarsAsc.length;
  // 「当前垫抽」：最近一次抽卡所在分类的垫抽数（保底按分类独立计算，混入其他分类会虚高）
  const pullsSinceLastSixStar = lastCategoryId === null ? 0 : counters.get(lastCategoryId) ?? 0;
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
    pullsSinceLastSixStar,
    newCharCount,
    poolCount: pools.size,
    pools: [...pools.values()].sort((a, b) => b.lastTs - a.lastTs),
    firstTs: asc.length > 0 ? asc[0]!.gachaTs : null,
    lastTs: asc.length > 0 ? asc[asc.length - 1]!.gachaTs : null,
    ...(categoryId ? { categoryId } : {}),
  };
}
