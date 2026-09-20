-- My Planet: updated_at 自动更新触发器

create or replace function public.handle_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger families_updated_at before update on public.families
  for each row execute function public.handle_updated_at();

create trigger members_updated_at before update on public.members
  for each row execute function public.handle_updated_at();

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.handle_updated_at();

create trigger items_updated_at before update on public.items
  for each row execute function public.handle_updated_at();
