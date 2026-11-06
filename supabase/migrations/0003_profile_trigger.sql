-- 0003: профиль пользователя создаётся автоматически вместе с аккаунтом.
--
-- Открытая регистрация в проекте выключена, аккаунты заводит админ (Management API
-- или дашборд), поэтому роль здесь выводится из локальной части email:
-- manager* → постановщик, остальные → исполнитель. Это удобное правило для
-- тестовых аккаунтов; в реальном проекте роль назначал бы админ отдельным полем.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    case when split_part(new.email, '@', 1) like 'manager%' then 'manager' else 'executor' end
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
