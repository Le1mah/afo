import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  trimValues: true,
});

const normalizeOutline = (outline) => {
  if (!outline) {
    return [];
  }
  const nodes = Array.isArray(outline) ? outline : [outline];
  return nodes.map((node) => {
    const { outline, ...rest } = node;
    return {
      title: node.title || node.text || node.xmlUrl || node.htmlUrl || 'Untitled',
      text: node.text || node.title || '',
      type: node.type || 'rss',
      xmlUrl: node.xmlUrl || null,
      htmlUrl: node.htmlUrl || null,
      attributes: rest,
      children: normalizeOutline(outline),
    };
  });
};

export const parseOpml = async (opmlPath) => {
  const absolutePath = path.isAbsolute(opmlPath)
    ? opmlPath
    : path.resolve(__dirname, '..', opmlPath);
  const raw = await fs.readFile(absolutePath, 'utf-8');
  const parsed = parser.parse(raw);
  const bodyOutlines = parsed?.opml?.body?.outline;
  if (!bodyOutlines) {
    return [];
  }
  return normalizeOutline(bodyOutlines);
};

if (import.meta.url === pathToFileURL(process.argv[1])?.href) {
  const [, , input = 'Feeds.opml'] = process.argv;
  parseOpml(input)
    .then((feeds) => {
      console.log(JSON.stringify(feeds, null, 2));
    })
    .catch((error) => {
      console.error(`Failed to parse OPML: ${error.message}`);
      process.exitCode = 1;
    });
}
