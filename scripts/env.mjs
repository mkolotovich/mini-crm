import { readFileSync } from 'node:fs';

/**
 * Читает .env.local без внешних зависимостей: скрипты должны запускаться
 * одной командой `node scripts/…` после npm install.
 */
export function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith('#')) continue;
      if (env[match[1]] === undefined) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* .env.local не обязателен, если переменные переданы окружением процесса */
  }
  return env;
}

export function requireEnv(name) {
  const value = loadEnv()[name];
  if (!value) {
    console.error(`Переменная ${name} не задана. Скопируйте .env.example в .env.local и заполните.`);
    process.exit(1);
  }
  return value;
}
