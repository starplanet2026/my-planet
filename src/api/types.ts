// 数据库实体类型定义

// 任务分类：4 个内置默认分类 key + 用户自定义分类 key
export type TaskCategory = string;
export const DEFAULT_TASK_CATEGORIES = ['daily', 'stage', 'super', 'black'] as const;
export type DefaultTaskCategory = typeof DEFAULT_TASK_CATEGORIES[number];

export type TaskStatus = 'draft' | 'active' | 'pending_approval' | 'completed' | 'expired' | 'deleted';
export type MemberRole = 'parent' | 'child';
export type ItemStatus = 'active' | 'sold_out' | 'expired' | 'deleted';
export type PurchaseStatus = 'pending' | 'redeemed' | 'expired' | 'cancelled' | 'sold';
export type CoinRecordCategory = 'task' | 'purchase' | 'manual' | 'system' | 'task_reject' | 'manual_adjust';

// 题库模块类型
export type ChallengeSetType = 'word_vocab' | 'math' | 'choice';
export type ChallengeSetStatus = 'draft' | 'active';
export type ChallengeBoardType = 'today_review' | 'gap_check' | 'wrong_battle' | 'advance';
// 七种题型 + math（兼容存量）+ word_vocab 走 words 表独立流程
export type QuestionType = 'choice' | 'multi_choice' | 'spell' | 'match' | 'scramble' | 'recite' | 'correct' | 'math';
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
  priority: number;
  is_default?: boolean;
}

// 任务分类
export interface TaskCategoryItem {
  id: string;
  family_id: string | null;
  key: string;
  name: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  reward_coins: number;
  created_at: string;
}

export interface Item {
  id: string;
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

// 宠物消息
export interface PetMessage {
  id: string;
  family_id: string;
  member_id: string;
  pet_id: string | null;
  event_type: 'level_up' | 'coin_harvest' | 'sick' | 'new_pet';
  pet_name: string | null;
  message: string;
  created_at: string;
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
  title: string;
  description: string | null;
  type: ChallengeSetType;
  board: ChallengeBoardType;
  subject: ChallengeSubject | null;
  // 分级别奖励星光值（按题目难度选择对应奖励）
  reward_easy: number;
  reward_medium: number;
  reward_hard: number;
  // 知识点：答题前/答题中可查看
  knowledge_points: string | null;
  knowledge_points_images: string[] | null;
  status: ChallengeSetStatus;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  challenge_set_id: string | null;
  level_id: string | null;
  type: QuestionType;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string | null;
  difficulty: Difficulty;
  display_order: number;
  is_active: boolean;
  metadata: Record<string, any> | null;
  created_at: string;
}

// ====== 关卡 / 板块 / 进度（二次开发新增） ======

export type ChallengeSubject = string;
export type LevelTargetSection = 'today_review' | 'gap_check' | 'advance';

export interface ChallengeLevel {
  id: string;
  challenge_set_id: string | null;
  level_no: number;
  title: string | null;
  description: string | null;
  pass_reward: number;
  status: 'active' | 'inactive';
  subject: ChallengeSubject | null;
  target_section: LevelTargetSection | null;
  published: boolean;
  knowledge_points: string | null;
  knowledge_points_images: string[] | null;
  created_at: string;
  sort_order?: number; // from challenge_set_levels junction
}

// get_challenge_boards RPC 返回的关卡（含进度统计）
export interface LevelWithProgress {
  id: string;
  level_no: number;
  sort_order: number;
  title: string | null;
  description: string | null;
  pass_reward: number;
  status: string;
  subject?: string | null;
  target_section?: string | null;
  total: number;
  mastered: number;
  is_cleared: boolean;
  is_paused: boolean;
  cleared_ids: string[];
  current_idx: number;
  easy_count?: number;
  medium_count?: number;
  hard_count?: number;
  knowledge_points?: string | null;
  knowledge_points_images?: string[] | null;
}

// get_challenge_boards RPC 返回的题集（含关卡列表）
export interface SetWithLevels {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  subject?: string | null;
  reward_easy: number;
  reward_medium: number;
  reward_hard: number;
  knowledge_points: string | null;
  knowledge_points_images: string[] | null;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  levels: LevelWithProgress[];
}

// get_challenge_boards RPC 返回的板块
export interface ChallengeBoard {
  board: ChallengeBoardType;
  sets: SetWithLevels[];
  levels: LevelWithProgress[]; // standalone published levels for this board
}

// load_level_snapshot RPC 返回
export interface LevelSnapshot {
  current_idx: number;
  cleared_question_ids: string[];
  is_cleared: boolean;
  is_paused: boolean;
  last_played_at: string | null;
}

// finish_challenge_level RPC 返回
export interface FinishLevelResult {
  level_awarded: boolean;
  level_reward: number;
  set_awarded: boolean;
  set_reward: number;
  new_star: number;
}

// 错题混战池条目
export interface WrongBattlePoolItem {
  pool_id: string;
  question_id: string;
  source_challenge_set_id: string | null;
  source_level_id: string | null;
  added_at: string;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string | null;
  type: string;
  difficulty: string;
  metadata: Record<string, any> | null;
}

// 错题统计（后台筛选用）
export interface WrongQuestionStat {
  question_id: string;
  challenge_set_id: string;
  question_text: string;
  type: string;
  difficulty: string;
  display_order: number;
  attempt_count: number;
  correct_count: number;
  wrong_count: number;
  error_rate: number;
  is_mastered: boolean;
  member_id: string | null;
  member_name: string | null;
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
  level_id: string | null;
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
  trait: string | null;
  valid_days: number | null;
  created_at: string;
  updated_at: string;
}

// 抽卡配置（全局单行表 gacha_config）
export interface GachaConfig {
  adopt_cost: number;          // 领养抽中宠物扣除的星光值
  cancel_penalty: number;      // 放弃抽卡扣除的星光值
  rarity_common_prob: number;  // 普通概率(%)
  rarity_rare_prob: number;    // 稀有概率(%)
  rarity_epic_prob: number;    // 史诗概率(%)
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
  word_en: string;
  word_cn: string;
  part_of_speech: string | null;
  part_of_speech_2: string | null;
  display_order: number;
  needs_review: boolean;
  original_display_order: number | null;
  status: 'active' | 'inactive';
  book_id: string;
  created_at: string;
}

// 词书
export interface PetWordBook {
  id: string;
  title: string;
  display_order: number;
  status: 'active' | 'inactive';
  created_at: string;
}

// 背景图
export interface PetBackground {
  id: string;
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
  current_book_id?: string | null;
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
  trait: string | null;
  days_without_feed: number;
  days_without_clean: number;
  days_without_care: number;
  has_stomach_issue: boolean;
  has_skin_issue: boolean;
  has_severe_illness: boolean;
  happiness_rounds: number;
  last_hunger_fill_at: string | null;
  hunger_decay_count: number;
  last_clean_fill_at: string | null;
  clean_decay_count: number;
  last_happiness_fill_at: string | null;
  happiness_decay_count: number;
  is_studying: boolean;
  study_start_date: string | null;
  study_total_star: number;
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

// 购买住所直接升级容量：不进背包，直接消费并扩容
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

// ====== 萌宠星球：特质 / 托管 / 进修 ======

export type PetTrait =
  | '体质强健' | '爱干净' | '大胃好养' | '乐天派'
  | '娇弱易感' | '容易脏' | '胃口消耗快' | '平平无奇';

export const TRAIT_DESC: Record<string, string> = {
  '体质强健': '体力消耗速度-20%，清洁消耗速度-20%',
  '爱干净': '清洁消耗速度-20%',
  '大胃好养': '体力消耗速度-20%',
  '乐天派': '健康恢复速度+20%',
  '娇弱易感': '体力消耗速度+20%，清洁消耗速度+20%',
  '容易脏': '清洁消耗速度+20%',
  '胃口消耗快': '体力消耗速度+20%',
  '平平无奇': '无特殊修正',
};

// 经验值需求表（按稀有度 + 等级）
const EXP_TABLE: Record<PetRarity, Record<number, number>> = {
  common: { 1:20,2:40,3:60,4:80,5:100,6:140,7:170,8:190,9:220 },
  rare:   { 1:20,2:40,3:60,4:80,5:100,6:120,7:140,8:160,9:180,10:200,11:310,12:340,13:360,14:390,15:420,16:450,17:480,18:500,19:530 },
  epic:   { 1:20,2:40,3:60,4:80,5:100,6:120,7:140,8:160,9:180,10:200,11:310,12:340,13:360,14:390,15:420,16:450,17:480,18:500,19:530,20:560,21:590,22:620,23:640,24:670 },
};

export function expNeeded(level: number, rarity: PetRarity): number {
  return EXP_TABLE[rarity]?.[level] ?? 999999;
}

// 进修每日星光
export function studyDailyStar(rarity: PetRarity): number {
  return rarity === 'common' ? 2 : rarity === 'rare' ? 5 : 10;
}

// 托管卡类型
export type BoardingCardType = 'daily' | 'weekly' | 'monthly';

export interface BoardingStatus {
  has_active_card: boolean;
  card_end_date: string | null;
  today_boarded_pet_ids: string[];
  selected_pet_ids: string[];
}

// 托管历史明细条目
export interface BoardingHistoryItem {
  board_date: string;
  pet_id: string;
  pet_name: string;
  pet_emoji: string | null;
  pet_image_url: string | null;
  hunger_gain: number;
  clean_gain: number;
  happiness_gain: number;
  exp_gain: number;
  coin_gain: number;
}

// 进修宠物信息
export interface StudyPet {
  pet_id: string;
  name: string;
  emoji: string | null;
  image_url: string | null;
  rarity: PetRarity;
  level: number;
  max_level: number;
  study_days: number;
  daily_star: number;
  pending_star: number;
  total_star: number;
}

export interface BuyBoardingCardResult {
  success: boolean;
  message: string;
  new_star: number;
  end_date: string | null;
}

export interface SetBoardingSelectionResult {
  success: boolean;
  message: string;
  selected_count: number;
}

export interface HealSevereResult {
  success: boolean;
  message: string;
  new_star: number;
}

export interface SendStudyResult {
  success: boolean;
  message: string;
}

export interface ClaimStudyResult {
  success: boolean;
  message: string;
  total_claimed: number;
  new_star: number;
}

// ==================== 家默模块类型 ====================
export type DictationSubject = 'english' | 'chinese';

export interface DictationWord {
  id: string;
  family_id: string;
  subject: DictationSubject;
  textbook_name: string;
  unit_no: number;
  unit_name: string;
  page_no: number | null;
  chinese_meaning: string | null;
  part_of_speech: string | null;
  pinyin: string | null;
  answer: string;
  created_at: string;
  updated_at: string;
}

export type DictationErrorStatus = 'in_progress' | 'completed';

export interface DictationErrorWord {
  id: string;
  member_id: string;
  subject: DictationSubject;
  word_id: string | null;
  textbook_name: string;
  unit_no: number;
  unit_name: string;
  page_no: number | null;
  chinese_meaning: string | null;
  part_of_speech: string | null;
  pinyin: string | null;
  answer: string;
  cycle_start_date: string;
  current_node: number;
  next_review_date: string;
  status: DictationErrorStatus;
  last_review_date: string | null;
  review_history: Array<{ date: string; correct: boolean; action: string }>;
  created_at: string;
  updated_at: string;
}

export type DictationTaskStatus = 'active' | 'completed';

export interface DictationTask {
  id: string;
  family_id: string;
  member_id: string;
  subject: DictationSubject;
  title: string;
  task_date: string | null;
  star_per_word: number;
  status: DictationTaskStatus;
  created_at: string;
  updated_at: string;
}

export interface DictationTaskWord {
  id: string;
  task_id: string;
  word_id: string | null;
  error_word_id: string | null;
  textbook_name: string;
  unit_no: number;
  unit_name: string;
  page_no: number | null;
  chinese_meaning: string | null;
  part_of_speech: string | null;
  pinyin: string | null;
  answer: string;
  is_temporary: boolean;
  save_to_library: boolean;
  created_at: string;
}

export interface DictationRecord {
  id: string;
  task_id: string;
  member_id: string;
  subject: DictationSubject;
  word_text: string;
  answer: string;
  is_correct: boolean;
  created_at: string;
}

export interface GrantDictationResult {
  success: boolean;
  message: string;
  total_star: number;
  new_star: number;
}

export interface SubmitDictationResult {
  success: boolean;
  message: string;
  correct_count: number;
  error_count: number;
  total_star: number;
  new_star: number;
}
