import { config } from './config.js';
import { retryOnError } from './retry.js';

/**
 * Execute a chat completion with ordered model fallback.
 * @param {Object} client - OpenAI-compatible client
 * @param {Object} request - Chat completion request without the model field
 * @param {Object} [options] - Execution options
 * @param {Function} [options.onModelFallback] - Called before falling back to the next model
 * @returns {Promise<{response: Object, model: string, attempts: Array<Object>}>}
 */
export const createChatCompletionWithFallback = async (client, request, options = {}) => {
  const { onModelFallback } = options;
  const attempts = [];
  let lastError = null;

  for (let index = 0; index < config.openaiModels.length; index++) {
    const model = config.openaiModels[index];

    try {
      const response = await retryOnError(
        async () => {
          return await client.chat.completions.create({
            ...request,
            model,
          });
        },
        {
          onRetry: (error, attempt, delay) => {
            console.warn(`OpenAI API retry for model ${model} (${attempt}) after ${delay}ms: ${error.message}`);
          },
        }
      );

      return {
        response,
        model,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        model,
        message: error.message,
        status: error.status ?? null,
        code: error.code ?? null,
      });

      if (index < config.openaiModels.length - 1) {
        onModelFallback?.(error, model, config.openaiModels[index + 1], index + 1);
      }
    }
  }

  if (lastError) {
    lastError.modelAttempts = attempts;
    throw lastError;
  }

  throw new Error('No OpenAI models configured');
};
