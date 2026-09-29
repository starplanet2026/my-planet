-- 0144: ASR 临时音频存储桶
insert into storage.buckets (id, name, public)
values ('asr-temp', 'asr-temp', false)
on conflict (id) do nothing;
