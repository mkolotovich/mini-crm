import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './env.mjs';

/**
 * Накатывает supabase/migrations/*.sql на удалённую базу.
 *
 * Почему не `supabase db push`: у проекта IPv4-доступ только через transaction-пулер
 * (прямой хост db.<ref> отдаёт лишь AAAA-запись), а pg-migrate в CLI на таком соединении
 * не работает. Поэтому файл разбивается на операторы и каждый уходит отдельным
 * сообщением. Версии пишутся в supabase_migrations.schema_migrations, чтобы `db push`
 * в другой среде не применил их повторно.
 */

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);

function safeRead(name) {
  try {
    return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Разбивает SQL на операторы: строки в одинарных кавычках, идентификаторы в
 * двойных, блочные комментарии и тела функций в $$...$$ — без этого `;` внутри
 * plpgsql разрывался бы пополам.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let index = 0;

  const push = () => {
    const trimmed = current.trim();
    const withoutComments = trimmed.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim();
    if (trimmed && withoutComments) statements.push(trimmed);
    current = '';
  };

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const found = sql.indexOf('\n', index);
      const stop = found === -1 ? sql.length : found;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const found = sql.indexOf('*/', index);
      const stop = found === -1 ? sql.length : found + 2;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (char === "'" || char === '"') {
      current += char;
      index += 1;
      while (index < sql.length) {
        current += sql[index];
        const closed = sql[index] === char;
        index += 1;
        if (closed) break;
      }
      continue;
    }

    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
    if (dollar) {
      const tag = dollar[0];
      current += tag;
      index += tag.length;
      const found = sql.indexOf(tag, index);
      const stop = found === -1 ? sql.length : found + tag.length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (char === ';') {
      push();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  push();
  return statements;
}

/**
 * Склеивает «drop … if exists» со следующим create в один запрос. Пулер рвёт
 * соединение уже после того, как сервер выполнил оператор, а retry повторяет его
 * с нуля: отдельно взятый `create trigger` на повторе дал бы «already exists».
 * В одном simple-запросе drop и create идут в одной транзакции и повтор безопасен.
 */
export function groupDropAndCreate(statements) {
  const isDrop = (statement) => /^drop (trigger|policy) if exists\b/i.test(statement.replace(/--[^\n]*\n?/g, '').trimStart());
  const merged = [];
  let pending = false;
  for (const statement of statements) {
    if (pending) {
      merged[merged.length - 1] = `${merged[merged.length - 1]};\n${statement}`;
      pending = false;
      continue;
    }
    merged.push(statement);
    pending = isDrop(statement);
  }
  return merged;
}

function connect() {
  const env = loadEnv();
  const ref = process.env.SUPABASE_PROJECT_REF ?? safeRead('supabase/.temp/project-ref') ?? '';
  const password = env.SUPABASE_DB_PASSWORD ?? safeRead('.db-password');

  if (!ref) throw new Error('Не известен ref проекта: выполните supabase link или задайте SUPABASE_PROJECT_REF');
  if (!password) throw new Error('Не найден пароль базы: задайте SUPABASE_DB_PASSWORD или файл .db-password');

  const host = process.env.SUPABASE_DB_HOST ?? 'aws-1-eu-central-1.pooler.supabase.com';

  return new pg.Client({
    host,
    port: Number(process.env.SUPABASE_DB_PORT ?? 6543),
    user: process.env.SUPABASE_DB_USER ?? `postgres.${ref}`,
    password,
    database: 'postgres',
    connectionTimeoutMillis: 20_000,
    // DDL может встать в блок на зависшей сессии пулера — лучше ошибиться и повторить, чем висеть
    query_timeout: 60_000,
    // Пулер Supabase подписан собственным корнем, которого нет в системном хранилище.
    // Он закреплён в certs/, поэтому проверка цепочки и имени остаётся включённой.
    ssl: {
      ca: [
        readFileSync(new URL('../certs/supabase-root-2021-ca.pem', import.meta.url), 'utf8'),
        readFileSync(new URL('../certs/supabase-intermediate-2021-ca.pem', import.meta.url), 'utf8'),
      ],
      servername: host,
      rejectUnauthorized: true,
    },
  });
}

/**
 * Пулер Supavisor отдаёт клиенту не больше пяти запросов на соединение: шестой
 * висит ~19 секунд и обрывается (проверено на обоих режимах пулера, 6543 и 5432,
 * и на обычных select, и на DDL). Соединение поэтому ротируем с запасом.
 */
const REQUESTS_PER_CONNECTION = 4;

export async function migrate() {
  const log = (line) => process.stderr.write(`${line}\n`);
  let client = null;
  let used = 0;

  const close = async (target) => {
    // Закрытие не должно блокировать работу: пулер не всегда отвечает на terminate.
    await Promise.race([target.end().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
  };

  /** Запрос на свежем соединении, если предыдущее уже отработало свой лимит. */
  const query = async (text, values) => {
    if (!client || used >= REQUESTS_PER_CONNECTION) {
      if (client) await close(client);
      client = await connectWithGuard(log);
      used = 0;
    }
    used += 1;
    return client.query(text, values);
  };

  try {
    await query('create schema if not exists supabase_migrations');
    await query(`create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      hash text
    )`);

    const { rows } = await query('select version from supabase_migrations.schema_migrations');
    const applied = new Set(rows.map((row) => row.version));
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      const version = file.split('_')[0];
      if (applied.has(version)) {
        log(`• ${file} — уже накатана, пропуск`);
        continue;
      }

      const statements = groupDropAndCreate(splitStatements(readFileSync(new URL(file, MIGRATIONS), 'utf8')));
      log(`→ ${file}: ${statements.length} операторов`);

      for (const [position, statement] of statements.entries()) {
        // Соединение может оборваться и уже после того, как сервер оператор выполнил.
        // Операторы идемпотентны (create or replace, if not exists, склеенные
        // drop + create), поэтому стратегия — переподключиться и повторить его.
        for (let attempt = 1; ; attempt += 1) {
          try {
            await query(statement);
            break;
          } catch (error) {
            if (!isDrop(error) || attempt >= 3) {
              throw new Error(
                `${file}, оператор ${position + 1} из ${statements.length}: ${error.message}\n    ${statement.slice(0, 200)}`,
              );
            }
            log(`  ⟳ оператор ${position + 1}: ${error.code ?? 'обрыв'}, попытка ${attempt + 1}`);
            await close(client);
            client = null;
          }
        }
      }

      await query(
        'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing',
        [version, file.replace(/\.sql$/, '')],
      );
      log(`✓ ${file}`);
    }

    const summary = await activeSummary();
    log(`\nТаблицы: ${summary.tables}`);
    log(`Политик RLS: ${summary.policies}`);
    log(`Без RLS: ${summary.without_rls ?? 'нет'}`);
  } finally {
    if (client) await close(client);
  }
}

/** Ошибки оборванного соединения — их можно повторить, остальные нет. */
function isDrop(error) {
  return (
    error.code === '57P01' ||
    error.code === 'ECONNRESET' ||
    error.errno === -4077 ||
    /ECONNRESET|Connection terminated|Query read timeout|timeout expired/i.test(error.message ?? '')
  );
}

/** Подключение, которое не роняет процесс асинхронным socket-error'ом. */
async function connectWithGuard(log) {
  const client = connect();
  client.on('error', (error) => log(`  ! ${error.code ?? 'error'}: ${error.message}`));
  await client.connect();
  return client;
}

async function activeSummary() {
  const client = await connectWithGuard(() => {});
  try {
    const { rows } = await client.query(`
      select
        (select string_agg(tablename, ', ' order by tablename) from pg_tables where schemaname = 'public') as tables,
        (select count(*)::int from pg_policies where schemaname = 'public') as policies,
        (select string_agg(relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false) as without_rls
    `);
    return rows[0];
  } finally {
    await Promise.race([client.end().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await migrate().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
