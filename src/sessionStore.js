/** @typedef {'idle' | 'quiz' | 'status_phone' | 'status_delivery' | 'faq'} Flow */

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
 * @property {'timeline' | 'budget' | null} waitingCustom
 * @property {string} [statusPhone]
 * @property {string} [statusContract]
 */

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

function emptySession() {
  return {
    flow: 'idle',
    quizStepIndex: 0,
    quizData: {},
    waitingCustom: null,
    statusPhone: undefined,
    statusContract: undefined,
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
 * Очистить поля квиза начиная с шага fromStep (0-based)
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
