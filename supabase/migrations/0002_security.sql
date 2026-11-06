-- 0002: функции проверки прав, RPC переходов, история, RLS.
--
-- Модель: тонкий клиент. Статус меняется ТОЛЬКО через set_task_status(),
-- каталог переходов живёт в таблице task_transitions и читается функцией
-- can_transition() — то есть запрещённый переход отклоняется базой, даже
-- если запрос пришёл в обход интерфейса (postgREST / curl).

-- ---------------------------------------------------------------- helpers --

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() = 'manager', false);
$$;

-- Постановщик может работать с любым объектом и любой задачей.
create or replace function public.is_object_manager(obj_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_manager() and exists (select 1 from public.objects o where o.id = obj_id), false);
$$;

-- Исполнитель видит задачу, только если она назначена на него.
-- Постановщик видит всё (по ТЗ).
create or replace function public.can_see_task(t_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_manager()
    or exists (
      select 1 from public.tasks t
      where t.id = t_id and t.assignee_id = (select auth.uid())
    ),
    false
  );
$$;

-- Объект виден исполнителю, если в нём есть хотя бы одна его задача.
-- Постановщик видит все объекты, включая пустые.
create or replace function public.can_see_object(obj_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_manager()
    or exists (
      select 1 from public.tasks t
      where t.object_id = obj_id and t.assignee_id = (select auth.uid())
    ),
    false
  );
$$;

-- ------------------------------------------------------ каталог переходов --

create table if not exists public.task_transitions (
  from_status public.task_status not null,
  to_status   public.task_status not null,
  actor_role  text not null check (actor_role in ('manager', 'executor')),
  comment_required boolean not null default false,
  primary key (from_status, to_status)
);

insert into public.task_transitions (from_status, to_status, actor_role, comment_required) values
  ('new',         'in_progress', 'executor', false),
  ('in_progress', 'review',      'executor', false),
  ('review',      'accepted',    'manager',  false),
  ('review',      'rework',      'manager',  true),
  ('rework',      'in_progress', 'executor', false)
on conflict (from_status, to_status) do update
   set actor_role = excluded.actor_role, comment_required = excluded.comment_required;

create or replace function public.can_transition(from_s public.task_status, to_s public.task_status, actor text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.task_transitions tr
      where tr.from_status = from_s and tr.to_status = to_s and tr.actor_role = actor
    ),
    false
  );
$$;

create or replace function public.transition_comment_required(from_s public.task_status, to_s public.task_status)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select tr.comment_required from public.task_transitions tr
      where tr.from_status = from_s and tr.to_status = to_s),
    false
  );
$$;

-- ------------------------------------------------------------------ RPC --

-- Единственный способ сменить статус.
create or replace function public.set_task_status(t_id uuid, to_s public.task_status, p_comment text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  t           public.tasks;
  actor       text;
  old_status  public.task_status;
  history_id  bigint;
begin
  actor := public.my_role();
  if actor is null then
    raise exception using errcode = '42501', message = 'Треббуется авторизация';
  end if;

  select * into t from public.tasks where id = t_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Задача не найдена';
  end if;

  old_status := t.status;

  if not public.can_transition(t.status, to_s, actor) then
    raise exception using errcode = 'CRM01',
      message = format('Переход %s → %s для роли %s запрещён', t.status, to_s, actor);
  end if;

  -- исполнитель — только назначенный на задачу
  if actor = 'executor' and t.assignee_id <> (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Задача назначена другому исполнителю';
  end if;

  if public.transition_comment_required(t.status, to_s)
     and (p_comment is null or length(trim(p_comment)) = 0) then
    raise exception using errcode = 'CRM02',
      message = 'Для возврата на доработку нужен комментарий';
  end if;

  update public.tasks
     set status = to_s, updated_at = now()
   where id = t_id
  returning * into t;

  insert into public.task_status_history (task_id, from_status, to_status, actor_id, actor_role, comment)
  values (t_id, old_status, to_s, (select auth.uid()), actor, nullif(trim(coalesce(p_comment, '')), ''))
  returning id into history_id;

  return t;
end;
$$;

-- Список возможных действий задачи для текущего пользователя.
-- UI строит по нему кнопки: права нигде не дублируются.
create or replace function public.task_actions(t_id uuid)
returns table (to_status public.task_status, comment_required boolean)
language sql
stable
security definer
set search_path = public
as $$
  select tr.to_status, tr.comment_required
  from public.task_transitions tr, public.tasks tk
  where tk.id = t_id
    and tr.from_status = tk.status
    and tr.actor_role = public.my_role()
    and (public.is_manager() or tk.assignee_id = (select auth.uid()))
    and public.can_see_task(t_id);
$$;

-- Постановщику — список исполнителей для назначения, только имена.
create or replace function public.list_executors()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles p
  where public.is_manager() and p.role = 'executor'
  order by p.full_name;
$$;

-- Имена пользователей для подписей «автор»/«исполнитель»/«кто менял статус».
-- Таблица profiles каждому видна только на себя (RLS), поэтому список имён —
-- security definer функция: она отдаёт id и отображаемое имя, но не email.
create or replace function public.profile_names()
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role from public.profiles p;
$$;

-- История задачи одним запросом (подписана security definer, читается по RLS ниже).
create or replace function public.task_history(t_id uuid)
returns table (
  id bigint,
  from_status public.task_status,
  to_status public.task_status,
  actor_name text,
  actor_role text,
  comment text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.from_status, h.to_status, p.full_name, h.actor_role, h.comment, h.created_at
  from public.task_status_history h
  left join public.profiles p on p.id = h.actor_id
  where h.task_id = t_id
    and public.can_see_task(t_id)
  order by h.id;
$$;

-- ------------------------------------------------------- защита полей БД --

-- Запрещены immutable-поля при UPDATE. Статус защищён отдельно —
-- column-level привилегиями в блоке grants ниже.
create or replace function public.protect_task_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Поля author_id/created_at неизменяемы';
  end if;
  if new.object_id is distinct from old.object_id then
    raise exception using errcode = '42501', message = 'Задачу нельзя переносить между объектами';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_protect on public.tasks;
create trigger tasks_protect
before update on public.tasks
for each row execute function public.protect_task_fields();

-- Назначить можно только исполнителю: CHECK не смотрит в другую таблицу,
-- поэтому роль проверяем триггером на вставке и правке.
create or replace function public.validate_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.assignee_id and p.role = 'executor'
  ) then
    raise exception using errcode = '23514', message = 'Исполнителем может быть только пользователь с ролью executor';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assignee_before on public.tasks;
create trigger tasks_assignee_before
before insert or update on public.tasks
for each row execute function public.validate_task_assignee();

-- Первая запись истории создаётся при вставке задачи (— → Новая).
-- Актором считается автор задачи, а не сессия: запись появляется и при сиде.
create or replace function public.log_task_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_status_history (task_id, from_status, to_status, actor_id, actor_role, comment)
  select new.id, null, new.status, new.author_id, p.role, null
  from public.profiles p
  where p.id = new.author_id;
  return new;
end;
$$;

drop trigger if exists tasks_after_insert on public.tasks;
create trigger tasks_after_insert
after insert on public.tasks
for each row execute function public.log_task_creation();

-- История неизменяема: UPDATE и DELETE блокируются на уровне самой таблицы.
-- Каскад от удаления задачи — не подделка истории: строки уходят вместе с задачей,
-- и это то, что обещано в ТЗ (постановщик удаляет задачу). Каскад выполняет триггер
-- внешних ключей, поэтому у него глубина вложенности больше единицы.
create or replace function public.block_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return null;
  end if;
  raise exception using errcode = '42501', message = 'История статусов не может быть изменена или удалена';
end;
$$;

drop trigger if exists history_no_update on public.task_status_history;
create trigger history_no_update
before update on public.task_status_history
for each statement execute function public.block_mutation();

drop trigger if exists history_no_delete on public.task_status_history;
create trigger history_no_delete
before delete on public.task_status_history
for each statement execute function public.block_mutation();

-- ------------------------------------------------------------------ RLS --

alter table public.profiles            enable row level security;
alter table public.objects             enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_status_history enable row level security;
alter table public.task_transitions    enable row level security;

-- profiles: каждый видит только себя; имена берутся через security definer функции.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (id = (select auth.uid()));

-- Объекты
drop policy if exists objects_read on public.objects;
create policy objects_read on public.objects
  for select using (public.can_see_object(id));

drop policy if exists objects_insert on public.objects;
create policy objects_insert on public.objects
  for insert with check (public.is_manager() and created_by = (select auth.uid()));

drop policy if exists objects_update on public.objects;
create policy objects_update on public.objects
  for update using (public.is_object_manager(id)) with check (public.is_object_manager(id));

drop policy if exists objects_delete on public.objects;
create policy objects_delete on public.objects
  for delete using (public.is_object_manager(id));

-- Задачи
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks
  for select using (public.can_see_task(id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    public.is_manager()
    and author_id = (select auth.uid())
    and status = 'new'
    and public.can_see_object(object_id)
  );

-- author_id/object_id/created_at отсекает триггер tasks_protect,
-- status — отсутствие привилегии на колонку (см. grants).
-- is_object_manager ждёт id объекта, поэтому здесь object_id, а не id: с `id`
-- политика не совпадала ни с одной строкой, и постановщик молча ничего не мог ни
-- изменить, ни удалить.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (public.is_object_manager(object_id)) with check (public.is_object_manager(object_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (public.is_object_manager(object_id));

-- История: только чтение в пределах видимости задачи. Записывает её исключительно
-- БД (trigger/set_task_status работают от владельца таблицы), поэтому пользовательский
-- INSERT запрещён политикой и отсутствием привилегии, а UPDATE/DELETE — триггерами.
drop policy if exists history_read on public.task_status_history;
create policy history_read on public.task_status_history
  for select using (public.can_see_task(task_id));

drop policy if exists history_insert on public.task_status_history;
create policy history_insert on public.task_status_history
  for insert with check (false);

-- Справочник переходов читается обеими ролями, изменить его нельзя (нет политик на insert/update/delete).
drop policy if exists transitions_read on public.task_transitions;
create policy transitions_read on public.task_transitions
  for select using (public.my_role() is not null);

-- ---------------------------------------------------------------- grants --

-- postgREST обращается к базе от имени ролей anon/authenticated, поэтому одних
-- политик RLS мало — закрываем и привилегии, вплоть до отдельных колонок.
-- Прямой UPDATE статуса задачи отклоняется базой: привилегии на колонку status нет,
-- и запрос падает ещё до триггеров и политик.

grant usage on schema public to anon, authenticated;

grant select on public.profiles, public.objects, public.tasks, public.task_status_history, public.task_transitions to authenticated;
grant insert on public.objects, public.tasks to authenticated;
grant delete on public.objects, public.tasks to authenticated;
-- внешние ключи проверяются с привилегией references у роли, которая вставляет
grant references on public.objects, public.profiles to authenticated;

-- постановщик правит содержимое; автор, создатель, дата и статус — не его руки.
-- В Supabase на новые таблицы по default privileges выдаётся ALL, включая UPDATE
-- на всю таблицу, а привилегия на всю таблицу шире привилегий на колонки.
-- Поэтому сначала забираем UPDATE целиком, потом возвращаем только нужные колонки.
revoke update on public.objects, public.tasks from authenticated;
grant update (name, address) on public.objects to authenticated;
grant update (title, description, assignee_id, updated_at) on public.tasks to authenticated;

grant execute on function public.set_task_status(uuid, public.task_status, text) to authenticated;
grant execute on function public.task_actions(uuid) to authenticated;
grant execute on function public.task_history(uuid) to authenticated;
grant execute on function public.list_executors() to authenticated;
grant execute on function public.profile_names() to authenticated;

-- незалогиненный не видит ничего
revoke all on public.profiles, public.objects, public.tasks, public.task_status_history, public.task_transitions from anon;
