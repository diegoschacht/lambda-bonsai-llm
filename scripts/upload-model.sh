#!/bin/bash
set -euo pipefail

# Downloads Bonsai-1.7B-ONNX q4 model files from Hugging Face and uploads to S3
# Prerequisites: python3 with huggingface_hub, aws cli configured

BUCKET="${1:-lambda-bonsai-llm-models}"
PREFIX="${2:-bonsai-1.7b-onnx}"
MODEL_ID="onnx-community/Bonsai-1.7B-ONNX"
LOCAL_DIR="/tmp/bonsai-1.7b-onnx"

echo "=== Bonsai 1.7B ONNX Model Upload Script ==="
echo "Model: $MODEL_ID (q4 variant)"
echo "S3 Target: s3://$BUCKET/$PREFIX/"
echo ""

# Step 1: Create S3 bucket if it doesn't exist
echo "Creating S3 bucket (if needed)..."
aws s3 mb "s3://$BUCKET" 2>/dev/null || echo "Bucket already exists"

# Step 2: Download only q4 model files + config/tokenizer from Hugging Face
echo "Downloading q4 model files from Hugging Face (~1.1GB)..."
if command -v hf &> /dev/null; then
  hf download "$MODEL_ID" --local-dir "$LOCAL_DIR" \
    --include "onnx/model_q4*" "config.json" "tokenizer.json" "tokenizer_config.json" "generation_config.json"
elif python3 -c "from huggingface_hub import snapshot_download" 2>/dev/null; then
  python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    '$MODEL_ID',
    local_dir='$LOCAL_DIR',
    allow_patterns=['onnx/model_q4*', 'config.json', 'tokenizer.json', 'tokenizer_config.json', 'generation_config.json'],
)
print('Download complete')
"
else
  echo "No Hugging Face download tool found."
  echo "Install with: pip3 install huggingface-hub"
  exit 1
fi

# Step 3: Upload to S3 (only q4 model files + configs)
echo "Uploading model files to S3..."
aws s3 sync "$LOCAL_DIR" "s3://$BUCKET/$PREFIX/" \
  --exclude "*" \
  --include "config.json" \
  --include "tokenizer.json" \
  --include "tokenizer_config.json" \
  --include "generation_config.json" \
  --include "onnx/model_q4*"

echo ""
echo "=== Upload complete ==="
echo "Model files are at: s3://$BUCKET/$PREFIX/"
echo ""
echo "To deploy the Lambda, run:"
echo "  npm run deploy"
