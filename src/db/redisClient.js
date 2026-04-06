import Redis from 'ioredis';

/** @type {Redis | null} */
let client = null;

export function getRedis() {
  if (!client) {
    throw new Error('Redis не подключён: сначала вызовите connectRedis()');
  }
  return client;
}

/**
 * @returns {Promise<Redis>}
 */
export async function connectRedis() {
  const url = process.env.REDIS_URL?.trim().replace(/^\uFEFF/, '');
  if (!url) {
    throw new Error('Задайте REDIS_URL в .env (например redis://127.0.0.1:6379)');
  }
  client = new Redis(url, {
    maxRetriesPerRequest: 20,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 200, 3000);
    },
  });
  await client.ping();
  return client;
}

export async function disconnectRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}
