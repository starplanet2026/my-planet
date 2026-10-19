-- 0275:「我的本命宠」性格测试 —— 成员级一次性测试与领养标记
-- 需求：一个子成员(member) 一生只能完成一次测试与领养；未领养时可重新测试（保留上次结果展示）
-- 说明：destiny_answers 存 32 题作答下标（jsonb），用于再次进入时重算人格与各维度占比

alter table public.members
  add column if not exists destiny_answers jsonb,
  add column if not exists destiny_type text,
  add column if not exists destiny_pet_id uuid,
  add column if not exists destiny_adopted_at timestamptz;

comment on column public.members.destiny_answers is '本命宠测试作答记录（32题选项下标数组）';
comment on column public.members.destiny_type is '本命宠测试人格编码，如 INFP';
comment on column public.members.destiny_pet_id is '本命宠领养后关联的 pets.id';
comment on column public.members.destiny_adopted_at is '本命宠领养时间；NULL 表示未领养（可重新测试）';

notify pgrst, 'reload schema';
