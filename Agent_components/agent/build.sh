#!/bin/bash
# Build script for Homelab Agent

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building Homelab Agent...${NC}"

# Get version
VERSION="1.0.0"

# Platforms to build for
PLATFORMS=(
    "linux/amd64"
    "linux/arm64"
    "linux/arm"
    "darwin/amd64"
    "darwin/arm64"
    "windows/amd64"
)

mkdir -p dist

for PLATFORM in "${PLATFORMS[@]}"; do
    GOOS=${PLATFORM%/*}
    GOARCH=${PLATFORM#*/}
    
    OUTPUT="dist/homelab-agent-${GOOS}-${GOARCH}"
    
    if [ "$GOOS" = "windows" ]; then
        OUTPUT="${OUTPUT}.exe"
    fi
    
    echo -e "${GREEN}Building for ${GOOS}/${GOARCH}...${NC}"
    
    GOOS=$GOOS GOARCH=$GOARCH go build \
        -ldflags="-X main.Version=${VERSION} -s -w" \
        -o "$OUTPUT" \
        .
        
    # Compress
    if command -v upx &> /dev/null; then
        echo "Compressing ${OUTPUT}..."
        upx -9 "$OUTPUT" 2>/dev/null || true
    fi
done

echo -e "${GREEN}Build complete! Binaries are in dist/${NC}"
ls -lh dist/
