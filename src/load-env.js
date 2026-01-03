import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const ENV_PATH = path.resolve(projectRoot, '.env');

const stripQuotes = (value) => {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const loadEnvFile = () => {
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trim().startsWith('#')) {
        continue;
      }
      const [key, ...rest] = line.split('=');
      if (!key || !rest.length) {
        continue;
      }
      const parsedKey = key.trim();
      if (!parsedKey || process.env[parsedKey] !== undefined) {
        continue;
      }
      process.env[parsedKey] = stripQuotes(rest.join('=').trim());
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to read .env file: ${error.message}`);
    }
  }
};
