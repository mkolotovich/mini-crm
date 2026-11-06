-- 0001: схема данных CRM «Объекты и задачи»
-- Таблицы, индексы и ограничения. Политики RLS — в миграции 0002.

create extension if not exists pgcrypto;

-- Роли пользователей. Совпадают с постфиксом email тестовых аккаунтов
-- (manager@ / executor1@ / executor2@), чтобы их нельзя было перепутать.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role        text not null check (role in ('manager', 'executor')),
  created_at  timestamptz not null default now()
);

-- Объект = стройка.
create table public.objects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 200),
  address     text not null check (char_length(trim(address)) between 1 and 300),
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create type public.task_status as enum (
  'new',          -- Новая
  'in_progress',  -- В работе
  'review',       -- На проверке
  'accepted',     -- Принята
  'rework'        -- На доработке
);

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(trim(title)) between 1 and 200),
  description   text not null default '',
  object_id     uuid not null references public.objects (id) on delete cascade,
  assignee_id   uuid references public.profiles (id),
  status        public.task_status not null default 'new',
  author_id     uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
  -- роль исполнителя проверяется триггером tasks_assignee_before (миграция 0002):
  -- CHECK не может сходить за подсчёт в profiles
);

-- История статусов. Пишется только из БД (см. политики 0002).
create table public.task_status_history (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  from_status public.task_status,
  to_status   public.task_status not null,
  actor_id    uuid not null,
  actor_role  text not null check (actor_role in ('manager', 'executor')),
  comment     text,
  created_at  timestamptz not null default now()
);

create index tasks_object_id_idx    on public.tasks (object_id);
create index tasks_assignee_id_idx  on public.tasks (assignee_id);
create index history_task_id_idx    on public.task_status_history (task_id, id);
create index objects_created_by_idx on public.objects (created_by);
