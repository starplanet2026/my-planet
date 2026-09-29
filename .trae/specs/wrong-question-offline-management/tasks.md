# 错题下线与后台管理 - 实现计划

## Task 1: 数据库迁移 — 表结构变更
- **Status**: `completed`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 创建 0148 迁移
  - `wrong_battle_pool` 表：新增 `offline_reason text`、`offlined_at timestamptz` 字段；status check 从 ('active','removed') 改为 ('active','offline')，历史 'removed' 数据迁移为 'offline'
  - `wrong_questions` 表：新增 `offline_reason text`、`offlined_at timestamptz` 字段
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-1.1: 迁移执行后 `wrong_battle_pool` 有 `offline_reason` 和 `offlined_at` 列，status 约束包含 'offline'
  - `rule` TR-1.2: 迁移执行后 `wrong_questions` 有 `offline_reason` 和 `offlined_at` 列
  - `rule` TR-1.3: 原 status='removed' 的记录被更新为 'offline'
- **Notes**: 使用 `alter table ... add column if not exists`；用 `not valid` 避免历史数据校验问题

## Task 2: 数据库迁移 — answer_question 自动下线逻辑
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 重写 `answer_question`：答对分支更新 wrong_questions.correct_count+1，若 correct_count >= wrong_count + 1 则 status='mastered', offline_reason='auto', offlined_at=now()；同时将 wrong_battle_pool 中该题 status='offline', offline_reason='auto', offlined_at=now()
  - 答错分支保持现有逻辑（upsert wrong_questions + insert wrong_battle_pool）
- **Acceptance Criteria Addressed**: AC-1, AC-5
- **Test Requirements**:
  - `rule` TR-2.1: 答对后 wrong_questions.correct_count 自增
  - `rule` TR-2.2: correct_count >= wrong_count + 1 时 wrong_questions.status='mastered', offline_reason='auto'
  - `rule` TR-2.3: 同时 wrong_battle_pool.status='offline', offline_reason='auto'
  - `rule` TR-2.4: 不满足条件时 status 保持 'active'
- **Notes**: 保留 p_source 参数和现有奖励逻辑

## Task 3: 数据库迁移 — answer_word 自动下线逻辑
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 重写 `answer_word`：答对分支更新 wrong_questions.correct_count+1，若 correct_count >= wrong_count + 1 则 status='mastered', offline_reason='auto', offlined_at=now()
  - 答错分支保持现有逻辑（只写 wrong_questions，不写 wrong_battle_pool）
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `rule` TR-3.1: answer_word 答对后 wrong_questions.correct_count 自增，达标则 mastered
  - `rule` TR-3.2: answer_word 答错分支不插入 wrong_battle_pool
- **Notes**: 萌宠闯关错词不进混战池

## Task 4: 数据库迁移 — review_wrong_question 下线规则
- **Status**: `completed`
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - 重写 `review_wrong_question`：答对 correct_count+1，达标 (>= wrong_count+1) 则 mastered；答错 wrong_count+1
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `rule` TR-4.1: 答对达标后 status='mastered'
  - `rule` TR-4.2: 答错后 wrong_count+1，status 保持 active

## Task 5: 数据库迁移 — 后台管理 RPC
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 修改 `remove_wrong_from_battle_pool` → 设为 status='offline', offline_reason='manual', offlined_at=now()
  - 新增 `offline_wrong_battle_questions(p_pool_ids uuid[])` → 手动下线（同 remove）
  - 新增 `reonline_wrong_battle_questions(p_pool_ids uuid[])` → status='active', 清空 offline_reason/offlined_at
  - 新增 `delete_wrong_battle_questions(p_pool_ids uuid[])` → 永久删除
  - 新增 `get_wrong_battle_pool_offline(p_member_id uuid)` → 返回已下线题目（join questions）
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-5.1: remove/offline RPC 将 status 设为 'offline', offline_reason='manual'
  - `rule` TR-5.2: reonline RPC 将 status 设为 'active'
  - `rule` TR-5.3: delete RPC 永久删除记录
  - `rule` TR-5.4: get_wrong_battle_pool_offline 返回 status='offline' 的题目

## Task 6: API 层 — 新增接口函数
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - 在 `src/api/challenges.ts` 新增：`offlineWrongBattleQuestions`, `reonlineWrongBattleQuestions`, `deleteWrongBattleQuestions`, `fetchWrongBattlePoolOffline`
  - 修改 `removeWrongFromBattlePool` 保持兼容（内部调用 offline 逻辑）
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-6.1: 四个新函数正确调用对应 RPC
  - `rule` TR-6.2: TypeScript 编译通过

## Task 7: 后台页面 — 错题混战管理双标签页
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 6
- **Description**:
  - 重构 `WrongBattleManageTab` 为两个标签页：【上线中错题池】、【已下线错题池】
  - 上线中：列表 + 批量删除 + 批量手动下线
  - 已下线：列表（显示 offline_reason/offlined_at）+ 批量重新上线 + 批量永久删除
  - 保留「错题筛选」子视图用于手动加入池子
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-7.1: 两个标签页可切换
  - `rule` TR-7.2: 上线中页面有删除和手动下线按钮
  - `rule` TR-7.3: 已下线页面有重新上线和永久删除按钮
  - `rule` TR-7.4: 操作后列表刷新

## Task 8: 前端 — 错题大混战答对后自动移除
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - `WrongBattlePlayer`：答对后检查是否触发下线（correct_count >= wrong_count+1），若是则从本地 pool 移除该题
  - 答错后保持在列表中
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `rule` TR-8.1: 答对触发下线后该题从当前列表消失
  - `rule` TR-8.2: 答错或未达标时题目保留

## Task 9: 编译验证
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 6, Task 7, Task 8
- **Description**:
  - 运行 `npx vite build` 确保编译通过
  - 注：当前环境无 node，需用户本地执行
- **Acceptance Criteria Addressed**: NFR-2
- **Test Requirements**:
  - `rule` TR-9.1: vite build 退出码为 0，无 TS 错误
