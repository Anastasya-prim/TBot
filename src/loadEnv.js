import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.warn('Файл .env не найден по пути:', envPath);
  } else {
    console.warn('dotenv:', result.error.message);
  }
} else {
  console.log('Загружен .env:', envPath);
}
