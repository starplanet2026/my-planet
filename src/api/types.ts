// 数据库实体类型定义

export type TaskCategory = 'daily' | 'stage' | 'super' | 'black';
export type TaskStatus = 'draft' | 'active' | 'pending_approval' | 'completed' | 'expired' | 'deleted';
export type MemberRole = 'parent' | 'child';
export type ItemStatus = 'active' | 'sold_out' | 'expired' | 'deleted';
export type PurchaseStatus = 'pending' | 'redeemed' | 'expired' | 'cancelled' | 'sold';
export type CoinRecordCategory = 'task' | 'purchase' | 'manual' | 'system' | 'task_reject' | 'manual_adjust';

// 题库模块类型
export type ChallengeSetType = 'word_vocab' | 'math' | 'choice';
export type ChallengeSetStatus = 'draft' | 'active';
export type QuestionType = 'choice' | 'math' | 'multi_choice';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type WordQuestionType = 'en2cn' | 'cn2en' | 'listen' | 'spell';

export interface Family {
  id: string;
  name: string;
  owner_user_id: string | null;
  parent_pin_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  family_id: string;
  name: string;
  role: MemberRole;
  avatar_emoji: string;
  coin_balance: number;
  star_value: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  family_id: string;
  member_id: string | null;
  title: string;
  description: string | null;
  category: TaskCategory;
  reward_coins: number;
  deadline: string | null;
  status: TaskStatus;
  icon: string | null;
  repeat_days: number[] | null;
  reject_reason: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

export interface TaskTemplate {
  id: string;
  family_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  reward_coins: number;
  created_at: string;
}

export interface Item {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  expires_at: string | null;
  voucher_validity_days: number | null;
  weekly_limit: number | null;
  status: ItemStatus;
  stock: number | null;
  category: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  family_id: string;
  item_id: string;
  item_name_snapshot: string;
  member_id: string;
  price_paid: number;
  quantity: number;
  code: string;
  status: PurchaseStatus;
  redeemed_by: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CoinRecord {
  id: string;
  family_id: string;
  member_id: string;
  amount: number;
  balance_after: number;
  reason: string;
  category: CoinRecordCategory;
  ref_type: string | null;
  ref_id: string | null;
  created_by: string;
  created_at: string;
  message: string | null;
  reply: string | null;
  balance_type: 'coin' | 'star';
}

// RPC 返回类型
export interface CompleteTaskResult {
  new_balance: number;
  reward: number;
}

export interface PurchaseItemResult {
  purchase_id: string;
  code: string;
  new_balance: number;
}

export interface SellPurchaseResult {
  new_balance: number;
  refund: number;
}

export interface AdjustCoinsResult {
  new_balance: number;
  amount: number;
}

export interface ConvertStarResult {
  new_star: number;
  new_coin: number;
}

export interface InitFamilyResult {
  family_id: string;
  member_id: string;
}

// ====== 题库模块 ======

export interface ChallengeSet {
  id: string;
  family_id: string;
  title: string;
  description: string | null;
  type: ChallengeSetType;
  // 分级别奖励星光值（按题目难度选择对应奖励）
  reward_easy: number;
  reward_medium: number;
  reward_hard: number;
  // 知识点：答题前/答题中可查看
  knowledge_points: string | null;
  status: ChallengeSetStatus;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  challenge_set_id: string;
  type: QuestionType;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string | null;
  difficulty: Difficulty;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Word {
  id: string;
  challenge_set_id: string;
  word_en: string;
  word_cn: string;
  phonetic: string | null;
  example_sentence: string | null;
  created_at: string;
}

export interface WordProgress {
  id: string;
  word_id: string;
  member_id: string;
  pass_en2cn: boolean;
  pass_cn2en: boolean;
  pass_listen: boolean;
  pass_spell: boolean;
  is_familiar: boolean;
  is_mastered: boolean;
  review_stage: number;
  next_review_at: string | null;
  wrong_count: number;
  last_reviewed_at: string | null;
}

export interface QuestionRecord {
  id: string;
  family_id: string;
  member_id: string;
  challenge_set_id: string | null;
  question_id: string | null;
  word_id: string | null;
  is_correct: boolean;
  reward_star: number;
  answered_at: string;
}

export interface WrongQuestion {
  id: string;
  family_id: string;
  member_id: string;
  question_id: string | null;
  word_id: string | null;
  challenge_set_id: string | null;
  wrong_count: number;
  correct_count: number;
  status: 'active' | 'mastered';
  last_wrong_at: string;
  created_at: string;
  // 关联数据（前端查询时 join）
  question?: Question;
  word?: Word;
}

// RPC 返回类型
export interface AnswerQuestionResult {
  is_correct: boolean;
  reward: number;
  is_mastered: boolean;
  bonus_reward: number;
  new_star: number;
}

// 挑战分析 RPC 返回类型
export interface ChallengeAnalysisItem {
  question_id: string;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  type: string;
  is_active: boolean;
  attempt_count: number;
  correct_count: number;
  is_mastered: boolean;
}

export interface AnswerWordResult {
  is_correct: boolean;
  reward: number;
  is_mastered: boolean;
  new_star: number;
}

export interface ReviewWrongResult {
  removed: boolean;
  new_star: number;
}

// ====== 萌宠星球模块 ======

export type PetShopItemType = 'pet' | 'supply';
export type PetSubcategory = 'dog' | 'cat' | 'food' | 'clean' | 'toy' | 'medicine' | 'foster' | 'doghouse';
export type PetRarity = 'common' | 'rare' | 'epic';

export interface PetShopItem {
  id: string;
  family_id: string;
  type: PetShopItemType;
  subcategory: PetSubcategory | null;
  name: string | null;
  emoji: string | null;
  image_url: string | null;
  description: string | null;
  price_star: number;
  price_coin: number;
  breed: string | null;
  base_coin_per_day: number;
  rarity: PetRarity;
  gender: 'male' | 'female' | null;
  stock: number | null;
  status: 'active' | 'inactive';
  doghouse_level: number | null;
  recovery_value: number;
  max_level: number;
  max_blood_bar: number;
  daily_decay_base: number;
  upgrade_coin_reward: number;
  upgrade_percent: number;
  created_at: string;
  updated_at: string;
}

// 背包物品
export interface PetInventory {
  id: string;
  family_id: string;
  member_id: string;
  item_id: string;
  item_name_snapshot: string;
  item_emoji: string | null;
  item_image_url: string | null;
  subcategory: PetSubcategory;
  quantity: number;
  created_at: string;
}

// 签到记录
export interface PetCheckin {
  id: string;
  family_id: string;
  member_id: string;
  checkin_date: string;
  consecutive_days: number;
  cycle_day: number;
  star_rewarded: number;
  created_at: string;
}

// 狗窝信息
export interface DogHouse {
  level: number;
  capacity: number;
  current_pet_count: number;
  upgrade_cost: number;
}

// 单词消消乐词库
export interface PetWord {
  id: string;
  family_id: string;
  word_en: string;
  word_cn: string;
  part_of_speech: string | null;
  display_order: number;
  needs_review: boolean;
  original_display_order: number | null;
  status: 'active' | 'inactive';
  created_at: string;
}

// 背景图
export interface PetBackground {
  id: string;
  family_id: string;
  name: string;
  image_data: string;
  sort_order: number;
  created_at: string;
}

export interface PetWordProgress {
  id: string;
  family_id: string;
  member_id: string;
  total_rounds: number;
  total_matched: number;
  best_score: number;
  last_played_at: string | null;
  unlocked_level?: number;
}

export interface Pet {
  id: string;
  family_id: string;
  member_id: string;
  shop_item_id: string | null;
  name: string;
  emoji: string | null;
  image_url: string | null;
  gender: 'male' | 'female' | null;
  level: number;
  max_level: number;
  exp: number;
  exp_to_next: number;
  rarity: PetRarity;
  base_coin_per_day: number;
  upgrade_coin_reward: number;
  upgrade_percent: number;
  current_max_blood: number;
  daily_decay_base: number;
  evolved_bonus: number;
  hunger: number;
  clean: number;
  happiness: number;
  health: number;
  coin_balance: number;
  is_sick: boolean;
  pending_levelup: boolean;
  last_check_at: string;
  created_at: string;
}

export type PetActionType = 'feed' | 'clean' | 'play' | 'heal' | 'claim_coin';

export interface PetAction {
  id: string;
  pet_id: string;
  member_id: string;
  action_type: PetActionType;
  star_cost: number;
  coin_cost: number;
  coin_gain: number;
  created_at: string;
}

export interface BuyPetItemResult {
  success: boolean;
  message: string;
  new_star: number;
  new_coin: number;
  pet_id: string | null;
  inventory_qty: number;
}

export interface InteractPetResult {
  success: boolean;
  message: string;
  new_hunger: number;
  new_clean: number;
  new_happiness: number;
  new_health: number;
  inventory_qty: number;
}

export interface ClaimPetCoinsResult {
  success: boolean;
  message: string;
  claimed: number;
  new_coin: number;
}

export interface CheckinResult {
  success: boolean;
  message: string;
  star_rewarded: number;
  new_star: number;
  consecutive_days: number;
  cycle_day: number;
  already_checked: boolean;
}

export interface UpgradeDogHouseResult {
  success: boolean;
  message: string;
  new_level: number;
  new_capacity: number;
  new_star: number;
}

// 购买狗屋直接升级容量：不进背包，直接消费并扩容
export interface BuyDoghouseUpgradeResult {
  success: boolean;
  message: string;
  new_level: number;
  new_capacity: number;
  new_star: number;
  new_coin: number;
}

export interface FinishWordMatchResult {
  success: boolean;
  star_rewarded: number;
  new_star: number;
  new_best_score: number;
}

// 闯关游戏：关卡结果
export interface GameLevelResult {
  id: string;
  family_id: string;
  member_id: string;
  level: number;
  stars: number;
  reward_star: number;
  word_ids: string[];
  wrong_word_ids: string[];
  last_selected_word_ids: string[];
  completed_at: string;
}

// 闯关游戏：单词挑战统计
export interface GameWordStat {
  id: string;
  family_id: string;
  member_id: string;
  word_id: string;
  challenge_count: number;
  wrong_count: number;
  last_played_at: string | null;
  // join 数据
  word?: PetWord;
}

// 闯关游戏：结算结果
export interface FinishGameLevelResult {
  success: boolean;
  reward_star: number;
  new_star: number;
  new_unlocked_level: number;
}

// 关卡奖励配置
export interface LevelRewardConfig {
  wordCount: number;
  baseReward: number;
}

// 根据关卡号获取单词数和基础奖励（奖励=词数）
export function getLevelConfig(level: number): LevelRewardConfig {
  if (level >= 1 && level <= 20) return { wordCount: 5, baseReward: 5 };
  if (level >= 21 && level <= 40) return { wordCount: 8, baseReward: 8 };
  if (level >= 41 && level <= 60) return { wordCount: 10, baseReward: 10 };
  if (level >= 61 && level <= 80) return { wordCount: 12, baseReward: 12 };
  return { wordCount: 15, baseReward: 15 }; // 81-100
}
