import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.mjs';

/**
 * Подготовка тестовых данных: пользователи + объекты + задачи в разных статусах.
 *
 * Всё, кроме создания аккаунтов, идёт через тот же публичный API и те же сессии,
 * что и браузер: то есть сид заодно проверяет, что права и переходы работают.
 * Service role нужен только на шаге регистрации аккаунтов — открытая регистрация
 * на проекте выключена.
 */

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.error('Нужны VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (.env.local).');
  process.exit(1);
}
if (!serviceKey) {
  console.error('Нужен SUPABASE_SERVICE_ROLE_KEY — только для создания аккаунтов.');
  process.exit(1);
}

const USERS = [
  { email: env.TEST_MANAGER_EMAIL, password: env.TEST_MANAGER_PASSWORD, fullName: 'Ирина Постановщик' },
  { email: env.TEST_EXECUTOR1_EMAIL, password: env.TEST_EXECUTOR1_PASSWORD, fullName: 'Пётр Исполнителев' },
  { email: env.TEST_EXECUTOR2_EMAIL, password: env.TEST_EXECUTOR2_PASSWORD, fullName: 'Семён Строителей' },
];

const client = () => createClient(url, anonKey, { auth: { persistSession: false } });
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function ensureUsers() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const existing = new Set(data.users.map((user) => user.email));

  for (const user of USERS) {
    if (!user.email || !user.password) {
      throw new Error('В .env.local не заданы TEST_* переменные.');
    }
    if (existing.has(user.email)) {
      console.log(`• аккаунт уже есть: ${user.email}`);
      continue;
    }
    await admin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });
    console.log(`• аккаунт создан: ${user.email}`);
  }
}

async function signIn(user) {
  const session = client();
  const { error } = await session.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`Вход ${user.email} не удался: ${error.message}`);
  return session;
}

async function main() {
  await ensureUsers();

  const manager = await signIn(USERS[0]);
  const executor1 = await signIn(USERS[1]);
  const executor2 = await signIn(USERS[2]);

  const managerId = (await manager.auth.getUser()).data.user.id;
  const exec1 = (await executor1.auth.getUser()).data.user.id;
  const exec2 = (await executor2.auth.getUser()).data.user.id;

  // объекты видны постановщику, их и создаём
  const objects = [];
  for (const object of [
    { name: 'ЖК «Северный», блок А', address: 'ул. Румянцева, 4' },
    { name: 'Школа на 550 мест', address: 'пос. Мосты, ул. Школьная, 1' },
    { name: 'Склад класса A', address: 'промзона Восточная, лит. Б' },
  ]) {
    const { data, error } = await manager
      .from('objects')
      .insert({ ...object, created_by: managerId })
      .select('*')
      .single();
    if (error) throw new Error(`Объект не создан: ${error.message}`);
    objects.push(data);
    console.log(`• объект: ${data.name}`);
  }

  const [sever, school, warehouse] = objects;

  const tasks = [];
  const createTask = async (session, values) => {
    const { data, error } = await session
      .from('tasks')
      .insert({ ...values, status: 'new', author_id: managerId })
      .select('*')
      .single();
    if (error) throw new Error(`Задача «${values.title}» не создана: ${error.message}`);
    tasks.push(data);
    return data;
  };

  const geometry = await createTask(manager, {
    title: 'Проверить геометрию фундамента, ось 1–6',
    description: 'Выполнить съёмку, отклонения не более 10 мм, результат — актом.',
    object_id: sever.id,
    assignee_id: exec1,
  });
  const formwork = await createTask(manager, {
    title: 'Заменить опалубку на блоке Б',
    description: 'Щиты прогибются, поставить новые до бетонирования.',
    object_id: sever.id,
    assignee_id: exec2,
  });
  const rebar = await createTask(manager, {
    title: 'Поставить арматуру 12 мм на блок В',
    description: '',
    object_id: sever.id,
    assignee_id: null,
  });
  const screed = await createTask(manager, {
    title: 'Сдать акт скрытых работ по стяжке',
    description: 'Стяжка 60 мм, нужна подпись технадзора.',
    object_id: school.id,
    assignee_id: exec1,
  });
  const roofing = await createTask(manager, {
    title: 'Доложить по кровельному пирогу',
    description: 'Уточнить состав утеплителя и примыкания.',
    object_id: school.id,
    assignee_id: exec2,
  });

  // цикл статусов проходят те же функции, что и кнопки в интерфейсе
  const move = async (session, taskId, to, comment = null) => {
    const { error } = await session.rpc('set_task_status', { t_id: taskId, to_s: to, p_comment: comment });
    if (error) throw new Error(`Переход в ${to} не прошёл: ${error.message}`);
    console.log(`  → ${taskId.slice(0, 8)}: ${to}`);
  };

  console.log('• разворачиваем статусы');
  await move(executor1, geometry.id, 'in_progress');
  await move(executor2, formwork.id, 'in_progress');
  await move(executor2, formwork.id, 'review');
  await move(executor1, screed.id, 'in_progress');
  await move(executor1, screed.id, 'review');
  await move(manager, screed.id, 'accepted');
  await move(executor2, roofing.id, 'in_progress');
  await move(executor2, roofing.id, 'review');
  await move(manager, roofing.id, 'rework', 'Нет фотофиксации примыканий, приложите фото и акт.');
  await move(executor2, roofing.id, 'in_progress');

  console.log(`\nГотово. Доступы для проверки:`);
  for (const user of USERS) console.log(`  ${user.email} / ${user.password}`);
  console.log(`Объектов: ${objects.length}, задач: ${tasks.length}. Последняя («${rebar.title}») без исполнителя.`);
  console.log(`Объект «${warehouse.name}» оставлен без задач — исполнитель его не увидит.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
