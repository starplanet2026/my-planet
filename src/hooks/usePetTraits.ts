import { useState, useEffect } from 'react';
import { fetchPetTraits } from '../api/pets';
import type { PetTrait } from '../api/types';

// 加载全部特质配置（7 条预置特质），供后台编辑弹窗与前台展示端共用
export function usePetTraits() {
  const [traits, setTraits] = useState<PetTrait[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchPetTraits()
      .then(data => { if (mounted) setTraits(data); })
      .catch(() => { /* 静默失败，特质缺失时各展示端会兜底为"无特质" */ })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  // 按 id 索引：trait_id -> trait
  const traitMap: Record<string, PetTrait> = {};
  for (const t of traits) traitMap[t.id] = t;

  return { traits, traitMap, loading };
}
