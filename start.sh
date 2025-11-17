#!/bin/bash

echo "🚀 Starting Stable Diffusion Backend..."

# Pre-download popular models (optional, speeds up first run)
echo "📦 Pre-downloading models..."

# Uncomment to pre-download models
# python3 -c "from diffusers import StableDiffusionPipeline; StableDiffusionPipeline.from_pretrained('CompVis/stable-diffusion-v1-4')"

# Start the Flask server
echo "🌐 Starting Flask server on port 5000..."
python3 /app/sd-backend/app-lite.py

# Keep container running
tail -f /dev/null
