// 「我的本命宠」性格测试静态数据（32题 MBTI 简化版）
// 数据来源：《性格测试题目、性格文案、本命宠物》子表
// 前端静态常量，内容固定，无需后台维护

export type Dim = 'EI' | 'SN' | 'TF' | 'JP';
export type Level = 'strong' | 'medium' | 'weak';

/** 维度定义：left 端字母在前，right 端字母在后（如 EI = E 外向 / I 内向） */
export const DIM_META: { dim: Dim; left: string; right: string }[] = [
  { dim: 'EI', left: 'E', right: 'I' },
  { dim: 'SN', left: 'S', right: 'N' },
  { dim: 'TF', left: 'T', right: 'F' },
  { dim: 'JP', left: 'J', right: 'P' },
];

export interface QuizOption {
  text: string;
  /** 左端得分 */
  left: number;
  /** 右端得分 */
  right: number;
}

export interface QuizQuestion {
  id: number;
  dim: Dim;
  text: string;
  options: [QuizOption, QuizOption, QuizOption, QuizOption];
}

// 每题两端分值合计 10 分；单维度 8 题，单端总分范围 16~64，两端和恒为 80
export const QUIZ_QUESTIONS: QuizQuestion[] = [
  // ===== 维度1 E外向 / I内向（能量来源）=====
  { id: 1, dim: 'EI', text: '周末休息，哪种最让你恢复精力？', options: [
    { text: '约很多伙伴一起热闹玩耍', left: 8, right: 2 },
    { text: '找2-3个好朋友聊天玩耍', left: 6, right: 4 },
    { text: '单独安静看书画画，偶尔找人说话', left: 4, right: 6 },
    { text: '一个人独处，不希望被打扰', left: 2, right: 8 },
  ] },
  { id: 2, dim: 'EI', text: '班里来了新同学，你会？', options: [
    { text: '主动上前自我介绍，积极搭话', left: 8, right: 2 },
    { text: '如果对方看起来友好，会主动打招呼', left: 6, right: 4 },
    { text: '等对方主动来找我，再慢慢熟悉', left: 4, right: 6 },
    { text: '保持观察，不主动交流', left: 2, right: 8 },
  ] },
  { id: 3, dim: 'EI', text: '小组课堂讨论，你习惯？', options: [
    { text: '抢先表达想法，带动大家发言', left: 8, right: 2 },
    { text: '想到观点就主动说出来', left: 6, right: 4 },
    { text: '别人说完，我再补充自己想法', left: 4, right: 6 },
    { text: '大多时候倾听，很少开口', left: 2, right: 8 },
  ] },
  { id: 4, dim: 'EI', text: '一件很开心的事发生，你会？', options: [
    { text: '迫不及待分享给好多同学', left: 8, right: 2 },
    { text: '告诉几个好朋友', left: 6, right: 4 },
    { text: '只和家人说，不跟同学多说', left: 4, right: 6 },
    { text: '放在心里，很少主动提起', left: 2, right: 8 },
  ] },
  { id: 5, dim: 'EI', text: '课间十分钟，你更愿意？', options: [
    { text: '加入一群同学一起游戏打闹', left: 8, right: 2 },
    { text: '和1-2好友聊天小游戏', left: 6, right: 4 },
    { text: '自己安静做喜欢的小事', left: 4, right: 6 },
    { text: '独自待着，避开喧闹人群', left: 2, right: 8 },
  ] },
  { id: 6, dim: 'EI', text: '生日聚会，你更喜欢？', options: [
    { text: '人多热闹，很多小伙伴一起', left: 8, right: 2 },
    { text: '几个要好的朋友一起庆祝', left: 6, right: 4 },
    { text: '只和家人，少量亲友', left: 4, right: 6 },
    { text: '简单安静，不办热闹聚会', left: 2, right: 8 },
  ] },
  { id: 7, dim: 'EI', text: '被老师点名当众分享想法，你的感受？', options: [
    { text: '很兴奋，愿意表达', left: 8, right: 2 },
    { text: '有点紧张，但愿意尝试', left: 6, right: 4 },
    { text: '不太喜欢，但可以配合', left: 4, right: 6 },
    { text: '非常紧张，希望不要点名', left: 2, right: 8 },
  ] },
  { id: 8, dim: 'EI', text: '结束一整天集体活动后，你通常？', options: [
    { text: '意犹未尽，还想继续玩', left: 8, right: 2 },
    { text: '开心，但需要短暂休息', left: 6, right: 4 },
    { text: '觉得有点疲惫，想安静一会', left: 4, right: 6 },
    { text: '消耗很大，需要独处恢复', left: 2, right: 8 },
  ] },
  // ===== 维度2 S务实 / N想象（获取信息）=====
  { id: 9, dim: 'SN', text: '听别人讲故事，你更喜欢？', options: [
    { text: '真实发生的生活小故事', left: 8, right: 2 },
    { text: '有真实原型，但带一点趣味加工', left: 6, right: 4 },
    { text: '带一点奇幻想象的故事', left: 4, right: 6 },
    { text: '魔法、异世界幻想冒险故事', left: 2, right: 8 },
  ] },
  { id: 10, dim: 'SN', text: '做手工或者搭建模型，你偏好？', options: [
    { text: '严格跟着图纸、步骤完成', left: 8, right: 2 },
    { text: '大体按步骤，小地方微调', left: 6, right: 4 },
    { text: '参考思路，自由改动设计', left: 4, right: 6 },
    { text: '完全自由创造，不看参考图', left: 2, right: 8 },
  ] },
  { id: 11, dim: 'SN', text: '别人描述一件事情，你最先关心？', options: [
    { text: '这件事真实发生的细节', left: 8, right: 2 },
    { text: '事件大体经过，重点事实', left: 6, right: 4 },
    { text: '这件事背后的想法与猜想', left: 4, right: 6 },
    { text: '这件事能延伸出什么新可能', left: 2, right: 8 },
  ] },
  { id: 12, dim: 'SN', text: '画画的时候，你更喜欢？', options: [
    { text: '画现实里真实存在的事物', left: 8, right: 2 },
    { text: '画见过的东西，少量美化', left: 6, right: 4 },
    { text: '画半虚构、幻想生物', left: 4, right: 6 },
    { text: '画完全不存在的梦幻场景', left: 2, right: 8 },
  ] },
  { id: 13, dim: 'SN', text: '老师布置任务，你最希望？', options: [
    { text: '要求写得清清楚楚，一步一步', left: 8, right: 2 },
    { text: '有明确要求，少量自主空间', left: 6, right: 4 },
    { text: '大方向给我，细节自己安排', left: 4, right: 6 },
    { text: '只给主题，完全自由发挥', left: 2, right: 8 },
  ] },
  { id: 14, dim: 'SN', text: '看到一个新玩具，你首先关注？', options: [
    { text: '样子、颜色、触感、功能', left: 8, right: 2 },
    { text: '它能怎么玩，基础玩法', left: 6, right: 4 },
    { text: '能不能改造，玩出新花样', left: 4, right: 6 },
    { text: '它可以想象成别的角色/世界', left: 2, right: 8 },
  ] },
  { id: 15, dim: 'SN', text: '读科普短文，你更喜欢？', options: [
    { text: '真实的动物、自然事实', left: 8, right: 2 },
    { text: '真实知识附带小故事', left: 6, right: 4 },
    { text: '带有推测猜想的科学设想', left: 4, right: 6 },
    { text: '脑洞猜想、未来假想设定', left: 2, right: 8 },
  ] },
  { id: 16, dim: 'SN', text: '解决难题，你习惯？', options: [
    { text: '从已知事实入手一步步推', left: 8, right: 2 },
    { text: '依靠过往经验解决问题', left: 6, right: 4 },
    { text: '先猜想可能性再验证', left: 4, right: 6 },
    { text: '先大胆想象新思路', left: 2, right: 8 },
  ] },
  // ===== 维度3 T理性 / F共情（做决定）=====
  { id: 17, dim: 'TF', text: '同学不小心弄坏你的文具，你第一反应？', options: [
    { text: '分清对错、责任，讨论怎么赔偿', left: 8, right: 2 },
    { text: '先了解事情经过，理性沟通', left: 6, right: 4 },
    { text: '先关心同学有没有受伤、心情', left: 4, right: 6 },
    { text: '心疼同学，优先安抚对方情绪', left: 2, right: 8 },
  ] },
  { id: 18, dim: 'TF', text: '小组讨论出现争执，你优先？', options: [
    { text: '讲道理，判断方案谁更合理', left: 8, right: 2 },
    { text: '分析利弊，选出效果最好方案', left: 6, right: 4 },
    { text: '希望大家不要吵架，缓和气氛', left: 4, right: 6 },
    { text: '优先照顾所有人感受，维持和睦', left: 2, right: 8 },
  ] },
  { id: 19, dim: 'TF', text: '评价一件事情好不好，你更看重？', options: [
    { text: '规则、道理，是否公平合理', left: 8, right: 2 },
    { text: '这件事带来的实际结果好坏', left: 6, right: 4 },
    { text: '大家的感受是否舒服', left: 4, right: 6 },
    { text: '会不会伤害别人的情绪', left: 2, right: 8 },
  ] },
  { id: 20, dim: 'TF', text: '朋友难过不开心，你第一想法？', options: [
    { text: '帮他分析原因，找出解决办法', left: 8, right: 2 },
    { text: '帮他梳理问题，想可行对策', left: 6, right: 4 },
    { text: '安静陪伴，倾听他的感受', left: 4, right: 6 },
    { text: '安慰共情，优先照顾情绪', left: 2, right: 8 },
  ] },
  { id: 21, dim: 'TF', text: '两个同学争抢同一件物品，你会支持？', options: [
    { text: '按先后顺序、规则分配物品', left: 8, right: 2 },
    { text: '看客观条件，做出公平安排', left: 6, right: 4 },
    { text: '考虑谁更需要这个东西', left: 4, right: 6 },
    { text: '考虑谁情绪更失落，优先照顾', left: 2, right: 8 },
  ] },
  { id: 22, dim: 'TF', text: '别人提出对你的批评，你先看？', options: [
    { text: '这个批评有没有道理，是否客观', left: 8, right: 2 },
    { text: '看内容是否符合事实', left: 6, right: 4 },
    { text: '看对方说话的态度好不好', left: 4, right: 6 },
    { text: '看他的话会不会让我难受', left: 2, right: 8 },
  ] },
  { id: 23, dim: 'TF', text: '做选择的时候，你更相信？', options: [
    { text: '逻辑和道理', left: 8, right: 2 },
    { text: '事实与利弊权衡', left: 6, right: 4 },
    { text: '内心感受与他人心情', left: 4, right: 6 },
    { text: '同理心，照顾大家感受', left: 2, right: 8 },
  ] },
  { id: 24, dim: 'TF', text: '看到别人犯错，你第一反应？', options: [
    { text: '判断这件行为本身对或错', left: 8, right: 2 },
    { text: '思考犯错带来的后果', left: 6, right: 4 },
    { text: '好奇对方为什么会这样做', left: 4, right: 6 },
    { text: '体谅对方，理解他的难处', left: 2, right: 8 },
  ] },
  // ===== 维度4 J规划 / P随性（生活节奏）=====
  { id: 25, dim: 'JP', text: '周末放假，你更喜欢？', options: [
    { text: '提前写好计划，按安排执行', left: 8, right: 2 },
    { text: '有大致安排，尽量跟着计划', left: 6, right: 4 },
    { text: '有个简单想法，随机调整', left: 4, right: 6 },
    { text: '不做计划，想到什么做什么', left: 2, right: 8 },
  ] },
  { id: 26, dim: 'JP', text: '写作业时，你的习惯？', options: [
    { text: '排好顺序，一项一项完成', left: 8, right: 2 },
    { text: '想好顺序，中途少量调整', left: 6, right: 4 },
    { text: '有大概目标，顺序随意', left: 4, right: 6 },
    { text: '想到哪一题就写哪一题', left: 2, right: 8 },
  ] },
  { id: 27, dim: 'JP', text: '出门短途游玩，你偏好？', options: [
    { text: '提前规划路线、物品、时间', left: 8, right: 2 },
    { text: '准备大致行程清单', left: 6, right: 4 },
    { text: '知道目的地，细节现场决定', left: 4, right: 6 },
    { text: '边走边看，随缘探索', left: 2, right: 8 },
  ] },
  { id: 28, dim: 'JP', text: '你的书包、书桌，你喜欢？', options: [
    { text: '物品固定位置，保持整齐', left: 8, right: 2 },
    { text: '大体整齐，用完会归位', left: 6, right: 4 },
    { text: '够用就行，偶尔整理', left: 4, right: 6 },
    { text: '随意摆放，不用刻意收拾', left: 2, right: 8 },
  ] },
  { id: 29, dim: 'JP', text: '有一件几天后要交的任务，你会？', options: [
    { text: '尽早做完，避免临时赶工', left: 8, right: 2 },
    { text: '提前规划，分阶段完成', left: 6, right: 4 },
    { text: '临近截止前集中完成', left: 4, right: 6 },
    { text: '等到最后一刻再动手', left: 2, right: 8 },
  ] },
  { id: 30, dim: 'JP', text: '一件计划好的事情临时变动，你会？', options: [
    { text: '不舒服，尽量维持原有计划', left: 8, right: 2 },
    { text: '有点不习惯，需要调整', left: 6, right: 4 },
    { text: '可以接受，灵活改动', left: 4, right: 6 },
    { text: '很期待，喜欢临时新变化', left: 2, right: 8 },
  ] },
  { id: 31, dim: 'JP', text: '完成一件任务，你喜欢？', options: [
    { text: '一次性收尾，确定全部做完', left: 8, right: 2 },
    { text: '做完一部分，阶段性收尾', left: 6, right: 4 },
    { text: '边做边修改，不用立刻收尾', left: 4, right: 6 },
    { text: '保留修改空间，随时调整', left: 2, right: 8 },
  ] },
  { id: 32, dim: 'JP', text: '安排课余时间，你更喜欢？', options: [
    { text: '固定作息，每天时间安排稳定', left: 8, right: 2 },
    { text: '大体固定，少量弹性空间', left: 6, right: 4 },
    { text: '大方向稳定，经常临时调整', left: 4, right: 6 },
    { text: '没有固定安排，随机安排', left: 2, right: 8 },
  ] },
];

/** 单维度总分（两端合计） */
export const DIM_TOTAL = 80;

export interface TypeProfile {
  code: string;
  name: string;
  desc: string;
  petName: string;
  rarity: 'rare' | 'epic';
  priceStar: number;
  petText: string;
}

// 16型人格 → 本命宠映射（宠物按「名称+稀有度+星光值」三字段锁定 pet_shop_items）
export const TYPE_PROFILES: Record<string, TypeProfile> = {
  INFP: {
    code: 'INFP', name: '调停者',
    desc: '你心里住着一个小小理想家，相信世界可以变得更美好。你喜欢帮助别人，也很会替别人着想，常常偷偷在心里写好多温柔的小故事。',
    petName: '英短蓝猫', rarity: 'rare', priceStar: 295,
    petText: '你的本命宠物是英短蓝猫！它脾气好得像一尊佛，温和又有自己的小心思，跟你这个小理想家一样，心里装着好多温柔！',
  },
  INFJ: {
    code: 'INFJ', name: '提倡者',
    desc: '你看起来安安静静，其实心里装着很多想法和大梦想。你特别懂别人在想什么，是个贴心又坚持自己原则的小天使。',
    petName: '陨石边牧', rarity: 'rare', priceStar: 288,
    petText: '你的本命宠物是陨石边牧！它优雅聪明，爱美又机灵，跟你一样安静的外表下藏着大梦想，是懂得彼此的小知己！',
  },
  ENFP: {
    code: 'ENFP', name: '竞选者',
    desc: '你是班上的开心果+小太阳！满脑子都是新奇的点子，做什么都热情满满，还能感染身边的小伙伴一起high起来。',
    petName: '德文卷毛猫', rarity: 'epic', priceStar: 450,
    petText: '你的本命宠物是德文卷毛猫！它活泼粘人，像长不大的小精灵，跟你一样满脑子新奇点子，是永远嗨不停的快乐搭档！',
  },
  ENFJ: {
    code: 'ENFJ', name: '主人公',
    desc: '你是天生的领头羊，特别会照顾大家，能让每个人都被注意到、都被照顾到。你说话自带魅力，小伙伴都愿意跟着你走。',
    petName: '缅因猫', rarity: 'epic', priceStar: 580,
    petText: '你的本命宠物是缅因猫！它是温柔开朗的大哥哥，超级会照顾人，跟你一样自带魅力，是能让大家都团结的领头羊！',
  },
  INTP: {
    code: 'INTP', name: '逻辑学家',
    desc: '你是个小发明家大脑！遇到问题喜欢刨根问底，拆开想个明白。你脑子里装着好多别人想不到的奇妙点子，酷酷的。',
    petName: '黑白边牧', rarity: 'rare', priceStar: 295,
    petText: '你的本命宠物是黑白边牧！它和你一样聪明爱学习，是班里最会动脑筋的小学霸，你们一定能一起探索好多有趣的知识！',
  },
  INTJ: {
    code: 'INTJ', name: '建筑师',
    desc: '你是个小小战略家，做事有计划、有目标，还特别专注。你心里有张大大的地图，知道自己要往哪里去，很独立。',
    petName: '澳牧', rarity: 'epic', priceStar: 440,
    petText: '你的本命宠物是澳牧！它像你一样目标明确、专注认真，学指令比背单词还快，你们都是心里有张大地图的小高手！',
  },
  ENTP: {
    code: 'ENTP', name: '辩论家',
    desc: '你爱动脑筋，喜欢跟人讨论，嘴巴可伶俐了！一个问题你能想出好几种解决办法，总能把大家带到有趣的新思路里。',
    petName: '伯恩山犬', rarity: 'epic', priceStar: 560,
    petText: '你的本命宠物是伯恩山犬！它自信满满，觉得自己是全场最靓，跟你一样爱动脑筋、能言善道，是最闪亮的点子王！',
  },
  ENTJ: {
    code: 'ENTJ', name: '指挥官',
    desc: '你是天生的领导者！目标明确，行动力超强，遇到困难不退缩，还会带着小伙伴一起冲。你就是那个说干就干的人。',
    petName: '罗威纳', rarity: 'epic', priceStar: 580,
    petText: '你的本命宠物是罗威纳！它一脸严肃像在巡逻，其实是铁汉柔情，跟你一样目标明确、说干就干，是超有行动力的将军！',
  },
  ISFJ: {
    code: 'ISFJ', name: '守卫者',
    desc: '你是个贴心小卫士，做事认真又可靠，很会照顾身边的人。你记得大家的小细节，是小伙伴心里最让人安心的存在。',
    petName: '圣伯纳', rarity: 'epic', priceStar: 450,
    petText: '你的本命宠物是圣伯纳！它是温柔的大块头，趴着就能治愈全世界，跟你一样贴心又会照顾人，是能守护你的好朋友！',
  },
  ISFP: {
    code: 'ISFP', name: '探险家',
    desc: '你喜欢用眼睛和双手去感受世界，画画、做手工、看风景，总能发现生活里的小美好。你温柔又专注，是个小艺术家。',
    petName: '豹猫', rarity: 'epic', priceStar: 600,
    petText: '你的本命宠物是豹猫！它是机警聪明的探险家，眼神犀利，喜欢用感官发现世界，跟你一样爱探索生活里的小美好！',
  },
  ESFJ: {
    code: 'ESFJ', name: '执政官',
    desc: '你是大家的小管家，热心又周到，喜欢让每个人都开开心心。班级活动你组织得特别好，是温暖又靠谱的小伙伴。',
    petName: '阿拉斯加', rarity: 'rare', priceStar: 290,
    petText: '你的本命宠物是阿拉斯加！它是会融化冰山的大号暖宝宝，跟你一样热心周到，最爱把身边的人都照顾得开开心心！',
  },
  ESFP: {
    code: 'ESFP', name: '表演者',
    desc: '你是舞台上的小明星！喜欢展示自己，乐观又爱玩，走到哪都能带来欢笑。你就是那个闪闪发光、把快乐传给大家的人。',
    petName: '土松', rarity: 'rare', priceStar: 298,
    petText: '你的本命宠物是土松！它看着傲娇，其实心里乐开了花，跟你一样乐观爱玩，走到哪都能带来欢笑的小开心果！',
  },
  ISTJ: {
    code: 'ISTJ', name: '物流师',
    desc: '你是班里靠谱的小队长，做事认真负责、有条有理，说到做到。你让大家都觉得很放心，是踏实又可靠的好伙伴。',
    petName: '大黄', rarity: 'epic', priceStar: 600,
    petText: '你的本命宠物是大黄！它忠诚可靠，看家一绝，一脸严肃内心从容，跟你一样说到做到，是最让人放心的好搭档！',
  },
  ISTP: {
    code: 'ISTP', name: '鉴赏家',
    desc: '你是个动手小达人！遇到问题喜欢亲手解决，聪明又冷静。工具、玩具在你手里总能玩出新花样，超厉害。',
    petName: '美短虎斑猫', rarity: 'rare', priceStar: 300,
    petText: '你的本命宠物是美短虎斑猫！它身手矫健、聪明伶俐，是超会动手的小猎手，跟你这个动手小达人简直是天生一对！',
  },
  ESTJ: {
    code: 'ESTJ', name: '总经理',
    desc: '你是班上的小小组织者，规则感强、办事效率高，能把事情安排得明明白白。你让团队井井有条，是行动派担当。',
    petName: '棕虎斑狸花猫', rarity: 'epic', priceStar: 420,
    petText: '你的本命宠物是棕虎斑狸花猫！它是威风凛凛的狸花女王，身体强壮，抓老鼠一把好手，跟你一样能把事情安排得明明白白！',
  },
  ESTP: {
    code: 'ESTP', name: '企业家',
    desc: '你精力旺盛、反应超快，爱冒险也爱挑战，遇到新事物第一个冲上前。你是大家的行动派，说到就马上做到！',
    petName: '起司猫', rarity: 'rare', priceStar: 298,
    petText: '你的本命宠物是起司猫！它永远在跑酷的路上，精力无限爱冒险，跟你一样反应超快、说到做到，是最酷的行动派！',
  },
};

// 档位阈值（该端得分）：强烈 ≥56（≥70%）、中等 48~55（60%~68%）、微弱 40~47（50%~58%）
// 两端得分和恒为 80，胜出端必然 ≥40，故只需判断胜出端档位
export function scoreToLevel(score: number): Level {
  if (score >= 56) return 'strong';
  if (score >= 48) return 'medium';
  return 'weak';
}

// 维度档位模块短句（键：字母-档位），共 4 维度 × 2 端 × 3 档位 = 24 条
export const DIM_PHRASES: Record<string, string> = {
  'E-strong': '你是个超级外向的小太阳，人多的地方你就来劲，和大家玩最开心。',
  'E-medium': '你偏外向一点，喜欢和小伙伴玩，不过偶尔也需要安静待一会儿。',
  'E-weak': '你有一点点外向，在熟悉的人面前能放开聊，陌生人面前会稍微收一收。',
  'I-strong': '你是个安静的小精灵，更喜欢一个人或和一两个好朋友待着，这样最舒服。',
  'I-medium': '你偏内向一点，不太爱太热闹的场合，更喜欢安静地做自己的事。',
  'I-weak': '你有一点点内向，不太爱主动凑热闹，但熟了以后也能聊得很开心。',
  'S-strong': '你是个观察小达人，最爱真实好玩的生活细节，动手能力超强。',
  'S-medium': '你比较爱关注真实的事物，相信眼前看得见、摸得着的，很踏实。',
  'S-weak': '你有一点务实，喜欢实实在在的东西，不过偶尔也会冒出好玩的想象。',
  'N-strong': '你是个天马行空的小幻想家，满脑子新奇点子，最爱想象好玩的世界。',
  'N-medium': '你偏爱想象和创意，总能把普通的事情想出新花样，很有主见。',
  'N-weak': '你有一点点爱想象，除了看眼前，偶尔也喜欢畅想以后会发生什么。',
  'T-strong': '你是个冷静的小裁判，遇到事情先讲道理、想清楚，对错分得明明白白。',
  'T-medium': '你比较讲道理，做事会先想逻辑和结果，不太容易感情用事。',
  'T-weak': '你有一点点理性，遇到问题会先动脑分析，不过有时也会心软。',
  'F-strong': '你特别有同理心，很在乎别人的感受，是个温暖又贴心的小伙伴。',
  'F-medium': '你做决定时比较照顾大家的感受，心里总是惦记着别人开不开心。',
  'F-weak': '你有一点点敏感贴心，会在意别人的心情，希望大家都好好的。',
  'J-strong': '你很有规划，喜欢按计划一步步完成，做事稳稳当当。',
  'J-medium': '你偏有计划一点，习惯先把事情安排好，不过遇到变化也能调整。',
  'J-weak': '你有一点点爱规划，喜欢提前准备，但也能接受临时的小变动。',
  'P-strong': '你是个自由的小风，喜欢想到什么就做什么，最讨厌被安排得死死的。',
  'P-medium': '你比较随性，不喜欢太严格的计划，喜欢跟着感觉走。',
  'P-weak': '你有一点点随性，不太爱太固定的安排，留点弹性会更舒服。',
};

export interface DimensionResult {
  dim: Dim;
  leftLetter: string;
  rightLetter: string;
  leftScore: number;
  rightScore: number;
  /** 胜出端字母 */
  letter: string;
  level: Level;
  /** 进度条占比（0~1，左端字母对应 leftScore） */
  leftRatio: number;
  rightRatio: number;
  phrase: string;
}

export interface DestinyResult {
  code: string;
  profile: TypeProfile;
  dimensions: DimensionResult[];
}

/**
 * 计算测试结果。
 * @param answers 每题所选选项下标（长度 32，与 QUIZ_QUESTIONS 同序）
 * 平局（两端各 40 分）时取该维度第 1 题所选端的字母。
 */
export function computeDestinyResult(answers: number[]): DestinyResult {
  const dimensions: DimensionResult[] = [];

  for (const { dim, left, right } of DIM_META) {
    const qs = QUIZ_QUESTIONS.filter(q => q.dim === dim);
    let leftScore = 0;
    let rightScore = 0;
    qs.forEach(q => {
      const opt = q.options[answers[q.id - 1] ?? 0];
      leftScore += opt.left;
      rightScore += opt.right;
    });

    let winner: string;
    if (leftScore > rightScore) winner = left;
    else if (rightScore > leftScore) winner = right;
    else {
      // 平局：取该维度第 1 题所选端的字母
      const first = qs[0];
      const opt = first.options[answers[first.id - 1] ?? 0];
      winner = opt.left >= opt.right ? left : right;
    }

    const winnerScore = Math.max(leftScore, rightScore);
    const level = scoreToLevel(winnerScore);
    dimensions.push({
      dim, leftLetter: left, rightLetter: right,
      leftScore, rightScore, letter: winner, level,
      leftRatio: leftScore / DIM_TOTAL, rightRatio: rightScore / DIM_TOTAL,
      phrase: DIM_PHRASES[`${winner}-${level}`] ?? '',
    });
  }

  const code = dimensions.map(d => d.letter).join('');
  const profile = TYPE_PROFILES[code] ?? TYPE_PROFILES.INFP;
  return { code, profile, dimensions };
}
