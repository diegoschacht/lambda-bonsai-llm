import { pipeline as transformersPipeline, TextStreamer } from '@huggingface/transformers';
import { ensureModelLoaded } from './model-loader.js';

let cachedGenerator = null;

export async function generateText(prompt, options = {}) {
  const { maxNewTokens = 128, systemPrompt = 'You are a helpful assistant.' } = options;

  const generator = await getGenerator();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  console.log(`Generating response (max_new_tokens: ${maxNewTokens})...`);
  const startTime = Date.now();

  const output = await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const responseText = output[0].generated_text.at(-1).content;
  console.log(`Generation complete in ${elapsed}s`);

  return {
    text: responseText,
    generationTimeSeconds: parseFloat(elapsed),
  };
}

async function getGenerator() {
  if (cachedGenerator) {
    return cachedGenerator;
  }

  console.log('Initializing Transformers.js pipeline...');
  const modelDir = await ensureModelLoaded();

  cachedGenerator = await transformersPipeline(
    'text-generation',
    modelDir,
    {
      dtype: 'q4',
      local_files_only: true,
    },
  );

  console.log('Pipeline initialized successfully');
  return cachedGenerator;
}
