import { generateText } from './inference.js';

export async function handler(event) {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};

    const { prompt, max_new_tokens, system_prompt } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required field: prompt' }),
      };
    }

    const result = await generateText(prompt, {
      maxNewTokens: max_new_tokens || 128,
      systemPrompt: system_prompt || 'You are a helpful assistant.',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: result.text,
        metadata: {
          model: 'Bonsai-1.7B-ONNX',
          generation_time_seconds: result.generationTimeSeconds,
        },
      }),
    };
  } catch (error) {
    console.error('Inference error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Inference failed',
        message: error.message,
      }),
    };
  }
}
