# Multi-stage build for optimized image
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 as base

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/workspace/.cache/huggingface \
    TRANSFORMERS_CACHE=/workspace/.cache/huggingface

# Install Python and system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3-pip \
    git \
    wget \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Upgrade pip
RUN python3 -m pip install --upgrade pip

# Set working directory
WORKDIR /app

# Copy backend requirements first (for better caching)
COPY sd-backend/requirements.txt /app/requirements.txt

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy backend code
COPY sd-backend /app/sd-backend

# Copy frontend build
COPY sd-app /app/sd-app

# Create necessary directories
RUN mkdir -p /workspace/.cache/huggingface && \
    mkdir -p /app/sd-backend/lora_models && \
    mkdir -p /app/sd-app/public/generated

# Set permissions
RUN chmod -R 777 /workspace && \
    chmod -R 777 /app/sd-backend/lora_models && \
    chmod -R 777 /app/sd-app/public/generated

# Expose ports
EXPOSE 5000 5174

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Set working directory to backend
WORKDIR /app/sd-backend

# Start backend server
CMD ["python3", "app-lite.py"]
