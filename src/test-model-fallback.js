import assert from 'assert';
import { createChatCompletionWithFallback } from './model-fallback.js';

const createMockClient = () => {
  const calls = [];

  return {
    calls,
    chat: {
      completions: {
        create: async ({ model }) => {
          calls.push(model);

          if (model === 'bad-model') {
            const error = new Error('Model not found');
            error.status = 404;
            throw error;
          }

          return {
            choices: [
              {
                message: {
                  content: 'ok',
                },
              },
            ],
          };
        },
      },
    },
  };
};

const originalModels = process.env.OPENAI_MODELS;
process.env.OPENAI_MODELS = 'bad-model,good-model';

const { config } = await import('./config.js');
config.openaiModels = ['bad-model', 'good-model'];
config.openaiModel = 'bad-model';

const client = createMockClient();
const result = await createChatCompletionWithFallback(client, {
  messages: [{ role: 'user', content: 'test' }],
  max_tokens: 5,
});

assert.equal(result.model, 'good-model');
assert.deepEqual(client.calls, ['bad-model', 'good-model']);
assert.equal(result.response.choices[0].message.content, 'ok');

if (originalModels === undefined) {
  delete process.env.OPENAI_MODELS;
} else {
  process.env.OPENAI_MODELS = originalModels;
}

console.log('model fallback test passed');
