# Lambda Bonsai LLM — Serverless Inference PoC

Run a real LLM ([Bonsai 1.7B](https://huggingface.co/onnx-community/Bonsai-1.7B-ONNX)) entirely on AWS Lambda using [Transformers.js](https://huggingface.co/docs/transformers.js) and ONNX Runtime — no GPU, no containers, no SageMaker.

## Architecture

```
                         +------------------------------------------+
                         |          AWS Lambda (Node.js 20)         |
                         |                                          |
  HTTP POST              |  +----------+    +--------------------+  |
  --------+              |  |          |    |  inference.js      |  |
          |              |  | handler  |--->|  Transformers.js   |  |
  Function URL --------->|  |          |    |  + ONNX Runtime    |  |
  or API GW              |  +----------+    +--------------------+  |
  --------+              |                          |               |
                         |               +----------+----------+    |
                         |               |  model-loader.js    |    |
                         |               |  S3 -> /tmp (cached)|    |
                         |               +----------+----------+    |
                         +--------------------------|---------------+
                                                    |
                                          +---------v----------+
                                          |     S3 Bucket      |
                                          |  bonsai-1.7b-onnx/ |
                                          |  q4 model (~1.1GB) |
                                          |  + tokenizer files |
                                          +--------------------+
```

### How it works

1. **Request arrives** via Lambda Function URL (no timeout limit) or API Gateway (30s limit)
2. **Cold start**: `model-loader.js` downloads model files from S3 to `/tmp` (~8s on Lambda's internal network). A `.download-complete` marker file skips this on warm invocations
3. **Pipeline init**: Transformers.js loads the ONNX model into ONNX Runtime (CPU), creating a `text-generation` pipeline with q4 quantization
4. **Inference**: The pipeline processes the chat messages (system + user prompt) and generates tokens
5. **Warm invocations**: Both the model files (`/tmp`) and the pipeline (in-memory) are cached — subsequent requests skip steps 2-3

### Key design decisions

- **q4 quantization** (~1.1GB) — the q1 variant (291MB) only works with WebGPU, not CPU. q4 is the smallest CPU-compatible format
- **S3 + /tmp** over EFS or container baking — simpler setup, no VPC needed, fast S3→Lambda transfer within the same region
- **Lambda Function URL** instead of API Gateway alone — API GW has a hard 30s timeout, Function URL has none
- **onnxruntime-node override** to v1.24.3 — Transformers.js ships with v1.21 which doesn't support the `GatherBlockQuantized` operator used in Bonsai's quantized model
- **Package exclusions** strip non-linux binaries (darwin, win32, arm64, onnxruntime-web, sharp variants) reducing the zip from 400MB+ to 32MB

## Prerequisites

- **Node.js** 20+
- **AWS CLI** configured (`export AWS_PROFILE=<your-profile>`)
- **Serverless Framework** v4 (`npm install -g serverless`)
- **Python** + `huggingface-hub` (for model upload script: `pip install huggingface-hub`)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Upload model to S3

```bash
bash scripts/upload-model.sh
```

This downloads the Bonsai 1.7B q4 ONNX model from Hugging Face and uploads it to `s3://lambda-bonsai-llm-models/bonsai-1.7b-onnx/`.

> **Tip:** If your local internet is slow, create a temporary Lambda to transfer the model directly from Hugging Face to S3 in the cloud — see the approach in the project history.

### 3. Deploy

```bash
npm run deploy
```

### 4. Test

```bash
# Via Function URL (recommended — no timeout limit)
curl -s -X POST https://<your-function-url>/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "max_new_tokens": 16}'

# Via API Gateway (30s timeout)
curl -s -X POST https://<your-api-gw-url>/inference \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "max_new_tokens": 16}'
```

## API

### POST /

**Request body:**

```json
{
  "prompt": "Your question here",
  "max_new_tokens": 128,
  "system_prompt": "You are a helpful assistant."
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | string | *(required)* | The user message |
| `max_new_tokens` | number | 128 | Maximum tokens to generate |
| `system_prompt` | string | "You are a helpful assistant." | System instruction |

**Response:**

```json
{
  "response": "2 + 2 = 4\n\nLet me know if you'd like help",
  "metadata": {
    "model": "Bonsai-1.7B-ONNX",
    "generation_time_seconds": 5.5
  }
}
```

## Configuration

Edit `serverless.yml` to tune:

| Setting | Current | Description |
|---------|---------|-------------|
| `memorySize` | 3008 MB | Lambda memory |
| `timeout` | 300s | Max execution time (5 minutes) |
| `ephemeralStorageSize` | 2048 MB | `/tmp` storage for model files |
| `modelBucket` | `lambda-bonsai-llm-models` | S3 bucket name |
| `modelPrefix` | `bonsai-1.7b-onnx` | S3 key prefix |

## Project structure

```
lambda-bonsai-llm/
├── src/
│   ├── handler.js        # Lambda entry point — parses request, returns response
│   ├── inference.js      # Transformers.js pipeline — model init + text generation
│   └── model-loader.js   # S3 download — streams model files to /tmp with caching
├── scripts/
│   └── upload-model.sh   # Downloads model from HuggingFace, uploads to S3
├── serverless.yml        # Infrastructure — Lambda, API GW, IAM, packaging
└── package.json          # Dependencies + onnxruntime-node override
```

## Performance

| Metric | Value |
|--------|-------|
| Cold start (total) | ~30-60s (S3 download + model load + first inference) |
| Warm inference | ~5-6s for 16 tokens |
| Package size | 32 MB (compressed) |
| Model size on S3 | ~1.1 GB (q4 quantization) |
| Token speed | ~2-3 tokens/sec (CPU) |

## Known Limitations

- **CPU-only inference**: Lambda has no GPU — inference is slow compared to GPU-backed solutions
- **Cold starts**: First invocation downloads ~1.1GB from S3 and loads the model into memory
- **Memory ceiling**: Account-limited to 3008MB (some accounts allow up to 10GB)
- **Token length**: Keep `max_new_tokens` reasonable (16-128) to stay within Lambda timeout
- **No streaming**: Response is returned all at once after generation completes

## Cleanup

```bash
npm run remove                                    # Delete Lambda + API GW stack
aws s3 rb s3://lambda-bonsai-llm-models --force   # Delete S3 bucket + model
```
