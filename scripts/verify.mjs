import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.mjs';

/**
 * Проверка безопасности в обход интерфейса: запросы идут прямо в Supabase,
 * как это сделал бы человек с anon-ключом и чужим токеном.
 * Запуск: node scripts/verify.mjs (после node scripts/setup.mjs)
 */

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('Нужны VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (.env.local).');
  process.exit(1);
}

const USERS = {
  manager: { email: env.TEST_MANAGER_EMAIL, password: env.TEST_MANAGER_PASSWORD },
  executor1: { email: env.TEST_EXECUTOR1_EMAIL, password: env.TEST_EXECUTOR1_PASSWORD },
  executor2: { email: env.TEST_EXECUTOR2_EMAIL, password: env.TEST_EXECUTOR2_PASSWORD },
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function as(who) {
  const session = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await session.auth.signInWithPassword(USERS[who]);
  if (error) throw new Error(`Вход ${USERS[who].email}: ${error.message}`);
  return session;
}

const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

async function main() {
  const manager = await as('manager');
  const executor1 = await as('executor1');
  const executor2 = await as('executor2');

  const ids = {
    manager: (await manager.auth.getUser()).data.user.id,
    executor1: (await executor1.auth.getUser()).data.user.id,
    executor2: (await executor2.auth.getUser()).data.user.id,
  };

  const { data: tasks } = await manager.from('tasks').select('*');
  if (!tasks?.length) throw new Error('Нет данных: сначала выполните node scripts/setup.mjs');
  const statusBefore = new Map(tasks.map((task) => [task.id, task.status]));

  const foreign = tasks.find((task) => task.assignee_id && task.assignee_id !== ids.executor1);
  const accepted = tasks.find((task) => task.status === 'accepted');
  const rework = tasks.find((task) => task.status === 'rework');
  const inProgress1 = tasks.find((task) => task.status === 'in_progress' && task.assignee_id === ids.executor1);
  const reviewTask = tasks.find((task) => task.status === 'review');

  const { data: objects } = await manager.from('objects').select('*');
  const emptyObject = objects.find((object) => !tasks.some((task) => task.object_id === object.id));

  // 1. Аноним без токена
  const anonSession = anon();
  const anonTasks = await anonSession.from('tasks').select('*');
  check('аноним не читает задачи', !anonTasks.data || anonTasks.data.length === 0, anonTasks.error?.code ?? '0 строк');
  const anonObjects = await anonSession.from('objects').select('*');
  check('аноним не читает объекты', !anonObjects.data || anonObjects.data.length === 0);

  // 2. Чужая задача не читается
  if (foreign) {
    const peek = await executor1.from('tasks').select('*').eq('id', foreign.id);
    check('исполнитель не читает чужую задачу по id', (peek.data ?? []).length === 0, peek.error?.code ?? 'пусто');
    const peekHistory = await executor1.rpc('task_history', { t_id: foreign.id });
    check('исполнитель не читает чужую историю', (peekHistory.data ?? []).length === 0);
  }

  // 3. Прямая смена статуса запрещена даже постановщику
  if (inProgress1) {
    const direct = await manager.from('tasks').update({ status: 'accepted' }).eq('id', inProgress1.id);
    check('прямой UPDATE статуса отклонён базой', !!direct.error, direct.error?.message ?? 'ожидали ошибку');
    const directExecutor = await executor1.from('tasks').update({ status: 'review' }).eq('id', inProgress1.id);
    check('прямой UPDATE статуса исполнителем отклонён', !!directExecutor.error, directExecutor.error?.message ?? '');
  }

  // 4. Незаконные переходы через RPC
  if (accepted) {
    const back = await manager.rpc('set_task_status', { t_id: accepted.id, to_s: 'in_progress' });
    check('принятую задачу нельзя вернуть в работу', !!back.error, back.error?.message ?? 'ожидали ошибку');
  }
  if (rework) {
    const executorAccepts = await executor2.rpc('set_task_status', { t_id: rework.id, to_s: 'accepted' });
    check('исполнитель не может принять задачу сам себе', !!executorAccepts.error, executorAccepts.error?.message ?? '');
  }
  if (inProgress1) {
    const managerTakes = await manager.rpc('set_task_status', { t_id: inProgress1.id, to_s: 'review' });
    check('постановщик не может отправить задачу на проверку вместо исполнителя', !!managerTakes.error);
    const silentRework = await manager.rpc('set_task_status', { t_id: inProgress1.id, to_s: 'rework', p_comment: null });
    check('из «В работе» в «На доработке» прямого пути нет', !!silentRework.error);
  }

  // 5. Комментарий обязателен при возврате на доработку
  if (reviewTask) {
    const noComment = await manager.rpc('set_task_status', { t_id: reviewTask.id, to_s: 'rework', p_comment: '   ' });
    check('возврат без комментария отклонён', !!noComment.error, noComment.error?.message ?? '');
  }

  // 6. Чужую задачу нельзя редактировать содержательно
  if (foreign) {
    const edit = await executor1.from('tasks').update({ title: 'Взломано' }).eq('id', foreign.id);
    const after = await manager.from('tasks').select('title').eq('id', foreign.id).single();
    check('исполнитель не переписывает чужую задачу', after.data.title !== 'Взломано', edit.error?.message ?? '0 строк изменено');
  }

  // 7. Объекты: исполнитель не создаёт и не трогает чужие
  const create = await executor1.from('objects').insert({ name: 'Чужой объект', address: '—', created_by: '00000000-0000-0000-0000-000000000000' });
  check('исполнитель не создаёт объект', !!create.error, create.error?.message ?? '');
  if (emptyObject) {
    const invisible = await executor1.from('objects').select('*').eq('id', emptyObject.id);
    check('объект без задач исполнителю не виден', (invisible.data ?? []).length === 0);
    const removed = await executor1.from('objects').delete().eq('id', emptyObject.id);
    check('исполнитель не удаляет объект', !!removed.error || (removed.count ?? 0) === 0, removed.error?.message ?? '');
  }

  // 8. История неизменяема
  const history = await manager.rpc('task_history', { t_id: tasks[0].id });
  check('история задачи читается', (history.data ?? []).length > 0, `${(history.data ?? []).length} записей`);
  const historyInsert = await manager.from('task_status_history').insert({
    task_id: tasks[0].id,
    to_status: 'accepted',
    actor_id: ids.manager,
    actor_role: 'manager',
  });
  check('запись в историю из API запрещена', !!historyInsert.error, historyInsert.error?.message ?? '');
  const anyHistory = await manager.from('task_status_history').select('id').limit(1);
  if (anyHistory.data?.length) {
    const updated = await manager.from('task_status_history').update({ comment: 'подделка' }).eq('id', anyHistory.data[0].id);
    check('историю нельзя изменить', !!updated.error, updated.error?.message ?? '0 строк');
    const deleted = await manager.from('task_status_history').delete().eq('id', anyHistory.data[0].id);
    check('историю нельзя удалить', !!deleted.error, deleted.error?.message ?? '0 строк');
  }

  // 9. Чужие профили и email не утекают
  const profiles = await executor1.from('profiles').select('*');
  check('исполнитель видит только свой профиль', (profiles.data ?? []).every((row) => row.id === ids.executor1), `${(profiles.data ?? []).length} строк`);

  // 10. Постановщик не может назначить исполнителем себя
  if (emptyObject) {
    const badAssign = await manager.from('tasks').insert({
      title: 'Проверка роли исполнителя',
      description: '',
      object_id: emptyObject.id,
      status: 'new',
      author_id: ids.manager,
      assignee_id: ids.manager,
    });
    check('исполнителем может быть только исполнитель', !!badAssign.error, badAssign.error?.message ?? '');
  }

  // 11. Позитивная часть: постановщик реально может создавать, править и удалять
  // задачи. Сломанная политика RLS не выдаёт ошибку — она молча не трогает строки,
  // поэтому без этой проверки права можно «сломать» и не заметить.
  if (emptyObject) {
    const scratch = await manager
      .from('tasks')
      .insert({
        title: 'Черновик для проверки прав',
        description: '',
        object_id: emptyObject.id,
        status: 'new',
        author_id: ids.manager,
      })
      .select('id')
      .single();
    check('постановщик создаёт задачу', !scratch.error, scratch.error?.message ?? '');

    if (scratch.data) {
      const edited = await manager
        .from('tasks')
        .update({ title: 'Черновик отредактирован' })
        .eq('id', scratch.data.id)
        .select('title')
        .single();
      check('постановщик правит задачу', edited.data?.title === 'Черновик отредактирован', edited.error?.message ?? '');

      const removed = await manager.from('tasks').delete().eq('id', scratch.data.id).select('id');
      check(
        'постановщик удаляет задачу',
        !removed.error && (removed.data ?? []).length === 1,
        removed.error?.message ?? `${(removed.data ?? []).length} строк`,
      );

      // История уходит вместе с задачей (каскад) — но только вместе с задачей,
      // см. проверку «историю нельзя удалить» выше.
      const orphaned = await manager.from('task_status_history').select('id').eq('task_id', scratch.data.id);
      check('история удалённой задачи не осиротела', (orphaned.data ?? []).length === 0, `${(orphaned.data ?? []).length} строк`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено.`);
  if (failed.length) {
    console.log('Проваленные:');
    for (const item of failed) console.log(`  • ${item.name}`);
    process.exit(1);
  }
  const after = await manager.from('tasks').select('id, status');
  const changed = (after.data ?? []).filter((task) => statusBefore.get(task.id) !== task.status);
  check('ни одна попытка не изменила статусы задач', changed.length === 0, `${changed.length} из ${statusBefore.size} задач`);
  const countAfter = await manager.from('tasks').select('id', { count: 'exact', head: true });
  check('ни одна попытка не добавила и не удалила задач', countAfter.count === statusBefore.size, `${countAfter.count} задач`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
