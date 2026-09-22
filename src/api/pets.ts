import { supabase } from './client';
import type {
  PetShopItem, Pet, PetShopItemType, PetSubcategory, PetRarity,
  PetInventory, PetCheckin, DogHouse, PetWord, PetWordProgress,
  BuyPetItemResult, ClaimPetCoinsResult,
  CheckinResult, UpgradeDogHouseResult, BuyDoghouseUpgradeResult, FinishWordMatchResult,
  PetBackground,
  GameLevelResult, GameWordStat, FinishGameLevelResult,
  BoardingStatus, StudyPet, BoardingCardType,
  BuyBoardingCardResult, BoardPetsResult, HealSevereResult, SendStudyResult, ClaimStudyResult,
} from './types';

// ====== 商店商品 ======

export async function fetchPetShopItems(type?: PetShopItemType, subcategory?: PetSubcategory, includeInactive = false): Promise<PetShopItem[]> {
  let q = supabase.from('pet_shop_items').select('*')
    .order('created_at', { ascending: false });
  if (!includeInactive) {
    q = q.eq('status', 'active');
  }
  if (type) q = q.eq('type', type);
  if (subcategory) q = q.eq('subcategory', subcategory);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PetShopItem[];
}

export async function createPetShopItem(data: {
  type: PetShopItemType;
  subcategory?: PetSubcategory;
  name?: string;
  emoji?: string;
  image_url?: string;
  description?: string;
  price_star?: number;
  price_coin?: number;
  breed?: string;
  base_coin_per_day?: number;
  rarity?: PetRarity;
  gender?: 'male' | 'female';
  stock?: number;
  doghouse_level?: number;
  recovery_value?: number;
  max_level?: number;
  max_blood_bar?: number;
  daily_decay_base?: number;
  upgrade_coin_reward?: number;
  upgrade_percent?: number;
}): Promise<PetShopItem> {
  const { data: result, error } = await supabase
    .from('pet_shop_items')
    .insert({ ...data, status: 'active' })
    .select()
    .single();
  if (error) throw error;
  return result as PetShopItem;
}

export async function updatePetShopItem(id: string, patch: Partial<PetShopItem>): Promise<PetShopItem> {
  const { data, error } = await supabase
    .from('pet_shop_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as PetShopItem;
}

export async function deletePetShopItem(id: string): Promise<void> {
  const { error } = await supabase.from('pet_shop_items').delete().eq('id', id);
  if (error) throw error;
}

// 批量上架/下架
export async function batchUpdatePetShopStatus(ids: string[], status: 'active' | 'inactive'): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('pet_shop_items').update({ status }).in('id', ids);
  if (error) throw error;
}

// 批量删除
export async function batchDeletePetShopItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('pet_shop_items').delete().in('id', ids);
  if (error) throw error;
}

// ====== 宠物 ======

export async function fetchPets(memberId: string): Promise<Pet[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Pet[];
}

// 查询家庭所有宠物（后台管理用）
export async function fetchAllPets(familyId: string): Promise<Pet[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*, members(name)')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

// 删除宠物（后台管理）
export async function deletePet(petId: string): Promise<void> {
  const { error } = await supabase.from('pets').delete().eq('id', petId);
  if (error) throw error;
}

// ====== 背包 ======

export async function fetchPetInventory(memberId: string): Promise<PetInventory[]> {
  const { data, error } = await supabase
    .from('pet_inventory')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PetInventory[];
}

// ====== 签到 ======

export async function fetchPetCheckins(memberId: string): Promise<PetCheckin[]> {
  const { data, error } = await supabase
    .from('pet_checkin')
    .select('*')
    .eq('member_id', memberId)
    .order('checkin_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PetCheckin[];
}

export async function petCheckin(memberId: string): Promise<CheckinResult> {
  const { data, error } = await supabase.rpc('pet_checkin', { p_member_id: memberId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as CheckinResult;
}

// ====== 狗窝 ======

export async function getDogHouse(memberId: string): Promise<DogHouse> {
  const { data, error } = await supabase.rpc('get_dog_house', { p_member_id: memberId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as DogHouse;
}

export async function upgradeDogHouse(memberId: string): Promise<UpgradeDogHouseResult> {
  const { data, error } = await supabase.rpc('upgrade_dog_house', { p_member_id: memberId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as UpgradeDogHouseResult;
}

// 购买住所用品直接扩容（不进背包，直接消费）
export async function buyDoghouseUpgrade(memberId: string, itemId: string): Promise<BuyDoghouseUpgradeResult> {
  const { data, error } = await supabase.rpc('buy_doghouse_upgrade', {
    p_member_id: memberId,
    p_item_id: itemId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as BuyDoghouseUpgradeResult;
}

// 进化宠物（不重置等级）
export async function evolvePet(petId: string, targetRarity: 'rare' | 'epic'): Promise<{ success: boolean; message: string; new_rarity: string; new_max_level: number; new_price_star: number }> {
  const { data, error } = await supabase.rpc('evolve_pet', {
    p_pet_id: petId,
    p_target_rarity: targetRarity,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { success: boolean; message: string; new_rarity: string; new_max_level: number; new_price_star: number };
}

// ====== 单词消消乐 ======

export async function fetchPetWords(): Promise<PetWord[]> {
  const { data, error } = await supabase
    .from('pet_words')
    .select('*')
    .eq('status', 'active')
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PetWord[];
}

export async function createPetWord(wordEn: string, wordCn: string, partOfSpeech?: string): Promise<PetWord> {
  // 取当前最大 display_order，新词排到队尾
  const { data: maxRow } = await supabase
    .from('pet_words')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.display_order ?? 0) + 1;
  const { data, error } = await supabase
    .from('pet_words')
    .insert({ word_en: wordEn, word_cn: wordCn, part_of_speech: partOfSpeech || null, display_order: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data as PetWord;
}

export async function createPetWordsBatch(words: { en: string; cn: string; pos?: string }[]): Promise<void> {
  if (words.length === 0) return;
  // 取当前最大 display_order，按 Excel 顺序追加
  const { data: maxRow } = await supabase
    .from('pet_words')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const startOrder = (maxRow?.display_order ?? 0) + 1;
  const rows = words.map((w, i) => ({
    word_en: w.en,
    word_cn: w.cn,
    part_of_speech: w.pos || null,
    display_order: startOrder + i,
  }));
  const { error } = await supabase.from('pet_words').insert(rows);
  if (error) throw error;
}

export async function deletePetWord(id: string): Promise<void> {
  const { error } = await supabase.from('pet_words').delete().eq('id', id);
  if (error) throw error;
}

// 批量删除单词
export async function batchDeletePetWords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('pet_words').delete().in('id', ids);
  if (error) throw error;
}

// 批量置顶：把选中的词移到最前面，其他词依次后移
export async function batchMovePetWordsTop(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // 1. 拉取全部词，按 display_order 升序
  const { data: allWords, error: e1 } = await supabase
    .from('pet_words')
    .select('id, display_order')
    .order('display_order', { ascending: true, nullsFirst: false });
  if (e1) throw e1;
  if (!allWords || allWords.length === 0) return;
  // 2. 拆分：选中 + 未选中（保持原相对顺序）
  const idSet = new Set(ids);
  const selected = allWords.filter(w => idSet.has(w.id));
  const rest = allWords.filter(w => !idSet.has(w.id));
  // 3. 重新分配 display_order：选中的放最前
  const ordered = [...selected, ...rest];
  const updates = ordered.map((w, i) => ({ id: w.id, display_order: i + 1 }));
  // 4. 批量更新（用 upsert 或逐个 update）
  for (const u of updates) {
    const { error } = await supabase
      .from('pet_words')
      .update({ display_order: u.display_order })
      .eq('id', u.id);
    if (error) throw error;
  }
}

// 批量置底：把选中的词移到最后，其他词依次前移
export async function batchMovePetWordsBottom(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: allWords, error: e1 } = await supabase
    .from('pet_words')
    .select('id, display_order')
    .order('display_order', { ascending: true, nullsFirst: false });
  if (e1) throw e1;
  if (!allWords || allWords.length === 0) return;
  const idSet = new Set(ids);
  const selected = allWords.filter(w => idSet.has(w.id));
  const rest = allWords.filter(w => !idSet.has(w.id));
  // 重新分配：未选中的放最前，选中的放最后
  const ordered = [...rest, ...selected];
  const updates = ordered.map((w, i) => ({ id: w.id, display_order: i + 1 }));
  for (const u of updates) {
    const { error } = await supabase
      .from('pet_words')
      .update({ display_order: u.display_order })
      .eq('id', u.id);
    if (error) throw error;
  }
}

export async function fetchPetWordProgress(memberId: string): Promise<PetWordProgress | null> {
  const { data, error } = await supabase
    .from('pet_word_progress')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) throw error;
  return data as PetWordProgress | null;
}

export async function finishWordMatch(memberId: string, matchedCount: number): Promise<FinishWordMatchResult> {
  const { data, error } = await supabase.rpc('finish_word_match', {
    p_member_id: memberId,
    p_matched_count: matchedCount,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as FinishWordMatchResult;
}

// 记录错题
export async function recordWrongWord(memberId: string, familyId: string, wordEn: string, wordCn: string): Promise<void> {
  const { error } = await supabase.rpc('record_wrong_word', {
    p_member_id: memberId,
    p_family_id: familyId,
    p_word_en: wordEn,
    p_word_cn: wordCn,
  });
  if (error) throw error;
}

// 解锁下一关
export async function unlockWordLevel(memberId: string, level: number): Promise<void> {
  const { error } = await supabase.rpc('unlock_word_level', {
    p_member_id: memberId,
    p_level: level,
  });
  if (error) throw error;
}

// 查询错题列表
export async function fetchWrongWords(memberId: string): Promise<PetWord[]> {
  const { data, error } = await supabase
    .from('pet_wrong_words')
    .select('*')
    .eq('member_id', memberId)
    .order('wrong_count', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PetWord[];
}

// ====== 闯关游戏 ======

// 查询某用户所有关卡结果
export async function fetchGameLevelResults(memberId: string): Promise<GameLevelResult[]> {
  const { data, error } = await supabase
    .from('game_level_results')
    .select('*')
    .eq('member_id', memberId)
    .order('level', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GameLevelResult[];
}

// 查询某用户某关结果（用于复习机制：取 N-2 关的错词和最后选词）
export async function fetchGameLevelResult(memberId: string, level: number): Promise<GameLevelResult | null> {
  const { data, error } = await supabase
    .from('game_level_results')
    .select('*')
    .eq('member_id', memberId)
    .eq('level', level)
    .maybeSingle();
  if (error) throw error;
  return data as GameLevelResult | null;
}

// 结算关卡
export async function finishGameLevel(
  memberId: string,
  familyId: string,
  level: number,
  stars: number,
  wordIds: string[],
  wrongWordIds: string[],
  lastSelectedWordIds: string[],
): Promise<FinishGameLevelResult> {
  const { data, error } = await supabase.rpc('finish_game_level', {
    p_member_id: memberId,
    p_family_id: familyId,
    p_level: level,
    p_stars: stars,
    p_word_ids: wordIds,
    p_wrong_word_ids: wrongWordIds,
    p_last_selected_word_ids: lastSelectedWordIds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as FinishGameLevelResult;
}

// 查询某用户所有单词挑战统计（后台用）
export async function fetchGameWordStats(memberId: string): Promise<GameWordStat[]> {
  const { data, error } = await supabase
    .from('game_word_stats')
    .select('*, word:pet_words(*)')
    .eq('member_id', memberId)
    .order('wrong_count', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GameWordStat[];
}

// ====== 背景图管理 ======

export async function fetchBackgrounds(): Promise<PetBackground[]> {
  const { data, error } = await supabase
    .from('pet_backgrounds')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PetBackground[];
}

export async function createBackground(name: string, imageData: string): Promise<PetBackground> {
  const { data, error } = await supabase
    .from('pet_backgrounds')
    .insert({ name, image_data: imageData })
    .select()
    .single();
  if (error) throw error;
  return data as PetBackground;
}

export async function deleteBackground(id: string): Promise<void> {
  const { error } = await supabase.from('pet_backgrounds').delete().eq('id', id);
  if (error) throw error;
}

// ====== 一次性迁移：把 base64 图片搬到 Storage ======
// 遍历 pet_shop_items 和 pet_backgrounds 中以 'data:' 开头的图片，
// 上传到 Storage 并更新为 URL
export async function migrateBase64ToStorage(
  familyId: string,
  uploadFn: (blob: Blob, familyId: string, category: 'shop' | 'backgrounds') => Promise<string>,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<{ shopMigrated: number; bgMigrated: number }> {
  let shopMigrated = 0;
  let bgMigrated = 0;

  // 1. 迁移 pet_shop_items.image_url
  const { data: shopItems, error: shopErr } = await supabase
    .from('pet_shop_items')
    .select('id, image_url');
  if (shopErr) throw shopErr;

  for (const item of shopItems ?? []) {
    if (!item.image_url || !item.image_url.startsWith('data:')) continue;
    onProgress?.(shopMigrated, shopItems?.length ?? 0, `商品图片 ${shopMigrated + 1}`);
    try {
      const blob = await (await fetch(item.image_url)).blob();
      const url = await uploadFn(blob, familyId, 'shop');
      await supabase.from('pet_shop_items').update({ image_url: url }).eq('id', item.id);
      shopMigrated++;
    } catch (e) {
      console.error('迁移商品图片失败', item.id, e);
    }
  }

  // 2. 迁移 pet_backgrounds.image_data
  const { data: bgs, error: bgErr } = await supabase
    .from('pet_backgrounds')
    .select('id, image_data');
  if (bgErr) throw bgErr;

  for (const bg of bgs ?? []) {
    if (!bg.image_data || !bg.image_data.startsWith('data:')) continue;
    onProgress?.(bgMigrated, bgs?.length ?? 0, `背景图 ${bgMigrated + 1}`);
    try {
      const blob = await (await fetch(bg.image_data)).blob();
      const url = await uploadFn(blob, familyId, 'backgrounds');
      await supabase.from('pet_backgrounds').update({ image_data: url }).eq('id', bg.id);
      bgMigrated++;
    } catch (e) {
      console.error('迁移背景图失败', bg.id, e);
    }
  }

  return { shopMigrated, bgMigrated };
}

// ====== RPC ======

export async function buyPetItem(memberId: string, itemId: string): Promise<BuyPetItemResult> {
  const { data, error } = await supabase.rpc('buy_pet_item', {
    p_member_id: memberId,
    p_item_id: itemId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as BuyPetItemResult;
}

export async function interactWithPet(memberId: string, petId: string, action: string, itemId: string): Promise<Pet> {
  const { data, error } = await supabase.rpc('interact_with_pet', {
    p_member_id: memberId,
    p_pet_id: petId,
    p_action: action,
    p_item_id: itemId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as Pet;
}

export async function checkPet(petId: string): Promise<Pet> {
  const { data, error } = await supabase.rpc('check_pet', { p_pet_id: petId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as Pet;
}

export async function claimPetCoins(memberId: string, petId: string): Promise<ClaimPetCoinsResult> {
  const { data, error } = await supabase.rpc('claim_pet_coins', {
    p_member_id: memberId,
    p_pet_id: petId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ClaimPetCoinsResult;
}

export async function updatePetInfo(petId: string, memberId: string, name: string, gender: 'male' | 'female' | null): Promise<void> {
  const { error } = await supabase.rpc('update_pet_info', {
    p_pet_id: petId,
    p_member_id: memberId,
    p_name: name,
    p_gender: gender,
  });
  if (error) throw error;
}

// 完成宠物升级挑战（需先通过错题本挑战，前端在 80% 正确率后调用）
export async function completePetLevelup(memberId: string, petId: string): Promise<Pet> {
  const { data, error } = await supabase.rpc('complete_pet_levelup', {
    p_member_id: memberId,
    p_pet_id: petId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as Pet;
}

// 陪伴学习任务完成奖励（星光值）
export async function studyTaskReward(memberId: string, reward: number): Promise<{ success: boolean; message: string; new_star: number }> {
  const { data, error } = await supabase.rpc('study_task_reward', {
    p_member_id: memberId,
    p_reward: reward,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { success: boolean; message: string; new_star: number };
}

// 陪伴学习记录
export interface StudyRecord {
  id: string;
  minutes: number;
  happiness_gain: number;
  star_earned: number;
  pet_name: string | null;
  tasks: { text: string; reward: number; done: boolean }[] | null;
  created_at: string;
}

export async function fetchStudyRecords(memberId: string, limit = 50): Promise<StudyRecord[]> {
  const { data, error } = await supabase.rpc('get_study_records', {
    p_member_id: memberId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as StudyRecord[];
}

// ====== 托管系统 ======

export async function buyBoardingCard(memberId: string, cardType: BoardingCardType): Promise<BuyBoardingCardResult> {
  const { data, error } = await supabase.rpc('buy_boarding_card', {
    p_member_id: memberId,
    p_card_type: cardType,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as BuyBoardingCardResult;
}

export async function boardPets(memberId: string, petIds: string[]): Promise<BoardPetsResult> {
  const { data, error } = await supabase.rpc('board_pets', {
    p_member_id: memberId,
    p_pet_ids: petIds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as BoardPetsResult;
}

export async function getBoardingStatus(memberId: string): Promise<BoardingStatus> {
  const { data, error } = await supabase.rpc('get_boarding_status', { p_member_id: memberId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as BoardingStatus;
}

// ====== 重症治疗 ======

export async function healSevereIllness(memberId: string, petId: string): Promise<HealSevereResult> {
  const { data, error } = await supabase.rpc('heal_severe_illness', {
    p_member_id: memberId,
    p_pet_id: petId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as HealSevereResult;
}

// ====== 进修系统 ======

export async function sendPetToStudy(memberId: string, petId: string): Promise<SendStudyResult> {
  const { data, error } = await supabase.rpc('send_pet_to_study', {
    p_member_id: memberId,
    p_pet_id: petId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as SendStudyResult;
}

export async function getStudyPets(memberId: string): Promise<StudyPet[]> {
  const { data, error } = await supabase.rpc('get_study_pets', { p_member_id: memberId });
  if (error) throw error;
  return (data ?? []) as StudyPet[];
}

export async function claimStudyStarlight(memberId: string): Promise<ClaimStudyResult> {
  const { data, error } = await supabase.rpc('claim_study_starlight', { p_member_id: memberId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ClaimStudyResult;
}
