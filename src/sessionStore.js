/** @typedef {'idle' | 'quiz' | 'status_phone' | 'status_delivery' | 'faq' | 'ai_faq'} Flow */

/**
 * @typedef {Object} QuizData
 * @property {string} [name]
 * @property {string} [furnitureType]
 * @property {string} [furnitureLabel]
 * @property {boolean} [needMeasure]
 * @property {string} [priority]
 * @property {string} [priorityLabel]
 * @property {string} [timeline]
 * @property {string} [budget]
 * @property {string} [phone]
 * @property {string} [sketchFileId]
 * @property {string} [sketchLink]
 */

/**
 * @typedef {Object} Session
 * @property {Flow} flow
 * @property {number} quizStepIndex
 * @property {QuizData} quizData
 * @property {'timeline' | 'budget' | 'furniture' | null} waitingCustom
 * @property {string} [statusPhone]
 * @property {string} [statusOrderId]
 */

const SESSION_PREFIX = 'tbot:sess:';
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const sessions = new Map();

/** @type {string[][]} поля по шагам квиза (для отката) */
const STEP_KEYS = [
  ['name'],
  ['furnitureType', 'furnitureLabel'],
  ['needMeasure'],
  ['priority', 'priorityLabel'],
  ['timeline'],
  ['budget'],
  ['phone'],
  ['sketchFileId', 'sketchLink'],
];

export function emptySession() {
  return {
    flow: 'idle',
    quizStepIndex: 0,
    quizData: {},
    waitingCustom: null,
    statusPhone: undefined,
    statusOrderId: undefined,
  };
}

/**
 * Дублирование прогресса квиза в БД — динамический import, чтобы не было циклической зависимости store ↔ sessionStore.
 */
async function persistQuizToDb(uid, s) {
  const { upsertQuizSession, deleteQuizSession } = await import('./db/store.js');
  if (s.flow === 'quiz') {
    await upsertQuizSession({
      telegramUserId: String(uid),
      quizStepIndex: s.quizStepIndex,
      quizData: s.quizData,
      waitingCustom: s.waitingCustom ?? null,
    });
  } else {
    await deleteQuizSession(uid);
  }
}

/**
 * @param {import('ioredis').default} redis
 */
export function createSessionMiddleware(redis) {
  return async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid == null) {
      return next();
    }
    const key = SESSION_PREFIX + uid;
    const raw = await redis.get(key);
    /** @type {Session} */
    let session = raw ? JSON.parse(raw) : emptySession();
    if (!session.quizData || typeof session.quizData !== 'object') session.quizData = {};
    sessions.set(uid, session);
    try {
      await next();
    } finally {
      const s = sessions.get(uid);
      if (s) {
        await redis.set(key, JSON.stringify(s), 'EX', SESSION_TTL_SEC);
        try {
          await persistQuizToDb(uid, s);
        } catch (e) {
          console.error('quiz_sessions:', e?.message || e);
        }
      }
    }
  };
}

/**
 * @param {number} userId
 * @returns {Session}
 */
export function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, emptySession());
  }
  return /** @type {Session} */ (sessions.get(userId));
}

/**
 * @param {number} userId
 */
export function resetSession(userId) {
  sessions.set(userId, emptySession());
}

/**
 * @param {QuizData} quizData
 * @param {number} fromStep
 */
export function truncateQuizDataFromStep(quizData, fromStep) {
  for (let s = fromStep; s < STEP_KEYS.length; s++) {
    for (const key of STEP_KEYS[s]) {
      delete quizData[key];
    }
  }
}
