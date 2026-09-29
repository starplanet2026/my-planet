# 错题下线与后台管理 - 产品需求文档

## Overview
- **Summary**: 重构错题系统的上线/下线逻辑，新增后台「已下线错题池」管理，统一错题自动下线判定规则
- **Purpose**: 让错题在满足掌握条件后自动从前端消失（转入已下线池），后台可查看、重新上线或永久删除
- **Target Users**: 孩子（前端错题大混战、查看错题）、家长（后台错题混战管理）

## Goals
- 错题自动下线规则统一为：`correct_count >= wrong_count + 1`
- 错题下线后转入「已下线错题池」，后台可查看、重新上线、永久删除
- 萌宠闯关（单词消消乐）的错词不进入错题大混战池
- 保留「查看错题」和「错题大混战」两个前端板块的答题功能

## Non-Goals
- 不修改萌宠闯关（pet game）的单词错词逻辑
- 不修改金币/星光值发放逻辑
- 不重构题集/关卡管理页面

## Background & Context
- `wrong_questions` 表：存储错题本，字段 `wrong_count`、`correct_count`、`status`（active/mastered）
- `wrong_battle_pool` 表：存储错题大混战池，字段 `status`（active/removed）
- 当前 `answer_question` 答对时：`correct_count+1`，`>=2` 则 mastered；答错时写入 wrong_questions + wrong_battle_pool
- 当前 `answer_word`（萌宠单词）答错时只写 wrong_questions，不写 wrong_battle_pool
- `get_wrong_battle_pool` 只返回 status='active' 的题目
- 后台 `WrongBattleManageTab` 有「错题筛选」和「错题混战池」两个子视图，支持批量加入/移除

## Functional Requirements
- **FR-1**: 智慧星战所有板块、宠物升级挑战答题产生的错题，自动进入 `wrong_questions` 和 `wrong_battle_pool`（status='active'）
- **FR-2**: 萌宠闯关（answer_word）产生的错词只进入 `wrong_questions`，不进入 `wrong_battle_pool`
- **FR-3**: 错题自动下线规则：同一道错题 `correct_count >= wrong_count + 1` 时，自动下线
- **FR-4**: 自动下线同时作用于两个前端板块：
  - 错题大混战池：`wrong_battle_pool.status` 设为 'offline'，`offline_reason='auto'`
  - 查看错题：`wrong_questions.status` 设为 'mastered'，`offline_reason='auto'`
- **FR-5**: 下线的错题不在前端显示，但数据保留在数据库中
- **FR-6**: 后台错题混战管理有两个标签页：【上线中错题池】和【已下线错题池】
- **FR-7**: 【上线中错题池】支持：批量删除、批量手动下线
- **FR-8**: 【已下线错题池】支持：查看全部已下线题目、批量重新上线、批量永久删除
- **FR-9**: 「查看错题」板块保留：完成关卡/题集后点击查看错题，展示本次错题，支持再战重做

## Non-Functional Requirements
- **NFR-1**: 所有数据库操作通过 Supabase RPC，不直接在前端写 SQL
- **NFR-2**: 前端编译通过，无 TypeScript 错误

## Constraints
- **Technical**: 使用现有 Supabase 迁移机制，新增 0148 迁移
- **Business**: 错题下线规则必须与产品定义一致（correct_count >= wrong_count + 1）
- **Dependencies**: 依赖现有 `wrong_questions`、`wrong_battle_pool`、`questions` 表

## Assumptions
- `wrong_questions.status='mastered'` 继续表示自动下线（不新增 'offline' 状态，避免破坏现有查询）
- `wrong_battle_pool.status` 从 ('active','removed') 改为 ('active','offline')，'removed' 历史数据迁移为 'offline'

## Acceptance Criteria

### AC-1: 错题自动下线规则
- **Type**: `rule`
- **Given**: 一道错题 wrong_count=2, correct_count=1
- **When**: 学生在错题大混战中答对该题
- **Then**: correct_count 变为 2，因 2 >= 2+1 不成立，不下线；再答对一次 correct_count=3，3 >= 2+1 成立，自动下线
- **Pass Condition**: correct_count >= wrong_count + 1 时 wrong_battle_pool.status='offline' 且 wrong_questions.status='mastered'
- **Evidence**: answer_question RPC 答对分支的 SQL 逻辑

### AC-2: 萌宠闯关错词不进混战池
- **Type**: `rule`
- **Given**: 学生在萌宠闯关中答错一个单词
- **When**: answer_word 执行
- **Then**: wrong_questions 有记录，但 wrong_battle_pool 无对应记录
- **Pass Condition**: answer_word 答错分支不插入 wrong_battle_pool
- **Evidence**: answer_word RPC 代码

### AC-3: 后台上线中错题池操作
- **Type**: `rule`
- **Given**: 后台选择上线中错题池的若干题目
- **When**: 点击「手动下线」或「删除」
- **Then**: 手动下线 → status='offline', offline_reason='manual'；删除 → 从数据库永久删除
- **Pass Condition**: 对应 RPC 正确更新/删除记录
- **Evidence**: offline_wrong_battle_questions / delete_wrong_battle_questions RPC

### AC-4: 后台已下线错题池操作
- **Type**: `rule`
- **Given**: 后台选择已下线错题池的若干题目
- **When**: 点击「重新上线」或「永久删除」
- **Then**: 重新上线 → status='active'；永久删除 → 从数据库删除
- **Pass Condition**: 对应 RPC 正确更新/删除记录
- **Evidence**: reonline_wrong_battle_questions / delete_wrong_battle_questions RPC

### AC-5: 前端错题大混战只显示上线中题目
- **Type**: `rule`
- **Given**: 学生打开错题大混战
- **When**: 加载错题池
- **Then**: 只显示 status='active' 的题目
- **Pass Condition**: get_wrong_battle_pool 过滤 status='active'
- **Evidence**: get_wrong_battle_pool RPC

### AC-6: 前端查看错题只显示活跃错题
- **Type**: `rule`
- **Given**: 学生完成关卡后点击查看错题
- **When**: 加载错题
- **Then**: 只显示 wrong_questions.status='active' 的题目
- **Pass Condition**: fetchLevelWrongQuestionStats 过滤 status='active'
- **Evidence**: challenges.ts fetchLevelWrongQuestionStats

### AC-7: 答题后自动从前端列表移除
- **Type**: `rule`
- **Given**: 学生在错题大混战中答对一道题并触发自动下线
- **When**: 进入下一题
- **Then**: 该题不再出现在当前错题大混战的题目列表中
- **Pass Condition**: 前端答对后从本地 pool 中移除该题，或重新加载时不再返回
- **Evidence**: WrongBattlePlayer handleSubmit/handleNext 逻辑

## Open Questions
- 无
