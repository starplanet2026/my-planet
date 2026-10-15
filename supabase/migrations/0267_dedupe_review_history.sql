-- 0267 清理 0235 迁移造成的错词库 history 双记事件（清单见 错词库双记清理清单.md）
-- 规则：每个 (日期,对错) 组删除尾部 0235 追加的重复事件，按现行规则重推节点（答对 1→2→4→7→15、第15节点再对1次才 completed、答错回第1节点）
-- 含 Stamp your card（人工复核升级：早间快速复习在小写词条创建前且全对，10-11 的 reset 必为重复追加）

-- [蓦地] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='0ff05a22-780f-4666-b5ac-166c5e98d3dc';

-- [cone] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='2988bb17-2794-4029-aabb-0beaab25b4d2';

-- [in a very short time] 删1条: 复习4→3 错误2→1 节点4→4
update public.dictation_error_words
set review_history='[{"date":"2026-09-29","action":"new","correct":false},{"date":"2026-10-07","action":"advance","correct":true},{"date":"2026-10-11","action":"advance","correct":true}]'::jsonb,
    review_count=3, error_count=1, current_node=4,
    status='in_progress', last_review_date='2026-10-11', next_review_date='2026-10-15'
where id='1685728e-973a-44fa-85b0-24ab774cd6ad';

-- [meat-eating] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='1739d13a-0291-49f1-8a09-ac022b618b15';

-- [visit] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='22870663-28de-4e0d-a3dd-b76a79bfd28a';

-- [Stamp your card] 删1条: 复习4→3 错误3→2 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-07","action":"new","correct":false},{"date":"2026-10-11","action":"advance","correct":true},{"date":"2026-10-11","action":"new","correct":false}]'::jsonb,
    review_count=3, error_count=2, current_node=1,
    status='in_progress', last_review_date='2026-10-11', next_review_date='2026-10-12'
where id='780a6928-079f-4729-88e8-834addeeb912';

-- [窟窿] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='3b695832-fd38-4438-9b0d-8c781d01793d';

-- [be covered with + 名词] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='3bc127a2-014f-450d-a76a-87f186580a00';

-- [in a very short time] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='3d4f4ef4-f18b-4e80-883e-e1f9b43798e0';

-- [with your help] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-11","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-11', next_review_date='2026-10-12'
where id='46103d68-8a4a-4227-8ebb-1ef90bb9a571';

-- [botanical garden] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='4c18b47c-4e51-481e-9f45-ff7415a3c46d';

-- [垂蔓] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='537735be-9a65-4ced-8f71-ce974604de3a';

-- [海峡] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='5490872d-34c3-4662-bda8-20fd74f6f33e';

-- [mud] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='5cedc451-1138-4db3-8c20-3ac8ed642f86';

-- [调遣] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='62ac0cf5-6f64-4246-a17f-6e751a960906';

-- [keep the sweet moments in life] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-11","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-11', next_review_date='2026-10-12'
where id='72be8014-6239-4799-a848-2049001b439e';

-- [黔驴技穷] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='7fb5b3bc-3865-403d-985b-1823b8a6968a';

-- [须臾] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='800064a0-71e2-4248-a5d4-6b2852c1109b';

-- [封锁] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='866a3910-fc9d-48b0-88a6-0fcc5f09e3ba';

-- [屹立] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='87b3bc6b-1a50-40bb-988d-b974d961a898';

-- [all over a wall] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='99317af7-59b7-4acd-a799-50d778a74b12';

-- [tulip] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='9c62046d-5544-4300-ab2c-a42e470a6adf';

-- [It's called an ice cream tulip.] 删1条: 复习5→4 错误3→2 节点4→4
update public.dictation_error_words
set review_history='[{"date":"2026-09-29","action":"new","correct":false},{"date":"2026-10-07","action":"reset","correct":false},{"date":"2026-10-11","action":"advance","correct":true},{"date":"2026-10-14","action":"advance","correct":true}]'::jsonb,
    review_count=4, error_count=2, current_node=4,
    status='in_progress', last_review_date='2026-10-14', next_review_date='2026-10-18'
where id='a038beff-14fd-4b5b-87d3-290185e332a4';

-- [嘈杂] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='a4f4372b-d343-4dec-a203-4a395eda0471';

-- [be called + 名称] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='a4f61c44-e9c6-4d17-8b79-9fefa3e9c87e';

-- [flycatcher] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='b3b6cd1a-3634-4fd1-8b78-264753c1bd8e';

-- [惊慌失措] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='b7372636-9080-4550-bcd5-c2b4e4ca06b9';

-- [深渊] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='bef385c6-073e-4088-bf5f-6dec5261c39f';

-- [履行] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='c4d188d6-24e9-44f0-8835-2033e09617ea';

-- [浓郁] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='c873d7bd-e8d0-4f55-88d5-246d2e01567e';

-- [酣睡] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='c9081091-c086-4ef5-aaee-ed0742678f54';

-- [a visit to the botanical garden] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='c9f669d4-a524-4501-8dad-8f208b548850';

-- [藤蔓] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='ca1bdad1-7886-438f-be3a-93721533fb80';

-- [失魂落魄] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='cbc3f02f-8b1e-474c-b463-60404bc5ac48';

-- [凤毛麟角] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='cc7cd6f2-7ff6-4f1e-a252-66b79977e7a4';

-- [龙飞凤舞] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='d6f9926c-e93e-4c15-93af-41ee068623bd';

-- [陷阱] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='da169517-fa20-4bbf-8481-817eb9bb9dd8';

-- [visit the botanical garden] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='e5354c2d-ed7b-489f-bc0f-7faf73ac658a';

-- [山丘] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='e68e0eaf-0dd7-4bbc-864d-795a745e096f';

-- [镇定自若] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='f06fa845-7ea7-48bf-a940-6c679ef633d0';

-- [猝然] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='34997fd1-c495-4b81-a882-6709a70159ba';

-- [秩序] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='5910148b-78be-4c21-bfe3-0efdefae4fbf';

-- [穿梭] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='be0cef3f-bfab-4d31-93af-56bdf7daa9cd';

-- [壮举] 删1条: 复习2→1 错误2→1 节点1→1
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false}]'::jsonb,
    review_count=1, error_count=1, current_node=1,
    status='in_progress', last_review_date='2026-10-01', next_review_date='2026-10-02'
where id='cfe70180-601b-402a-8164-b50d4a306411';

-- [主宰] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='2f2cca60-c44d-4c3e-a7e0-2fddfa46547b';

-- [机械师] 删1条: 复习3→2 错误0→0 节点7→4
update public.dictation_error_words
set review_history='[{"date":"2026-10-05","action":"advance","correct":true},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=0, current_node=4,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-16'
where id='187790f9-93ae-4870-a464-640cc1fed778';

-- [a meat-eating plant] 删1条: 复习3→2 错误2→1 节点2→2
update public.dictation_error_words
set review_history='[{"date":"2026-10-01","action":"new","correct":false},{"date":"2026-10-12","action":"advance","correct":true}]'::jsonb,
    review_count=2, error_count=1, current_node=2,
    status='in_progress', last_review_date='2026-10-12', next_review_date='2026-10-14'
where id='afcd95b1-42a5-4f18-a81f-341f1887c3bc';

notify pgrst, 'reload schema';
