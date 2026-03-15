#!/bin/bash
# Pinterest CSV Tool - Build and Serve

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Pinterest CSV Tool"
echo "=================="

# Parse arguments
WATCH_MODE=false
for arg in "$@"; do
    case $arg in
        --watch|-w)
            WATCH_MODE=true
            shift
            ;;
    esac
done

# Initial build if needed
if [ ! -d "$PROJECT_ROOT/frontend/dist" ]; then
    echo ""
    echo "Frontend not built. Building now..."
    cd "$PROJECT_ROOT/frontend"
    npm install
    npm run build
fi

# Copy built frontend to backend static dir
echo "Copying frontend to backend static directory..."
mkdir -p "$PROJECT_ROOT/backend/static"
cp -r "$PROJECT_ROOT/frontend/dist/"* "$PROJECT_ROOT/backend/static/"

if [ "$WATCH_MODE" = true ]; then
    echo ""
    echo "Starting in WATCH mode - frontend changes will auto-rebuild"
    echo "Backend at http://127.0.0.1:8000"
    echo "Frontend dev at http://localhost:5173"
    echo "Press Ctrl+C to stop"
    echo ""

    # Start frontend watcher in background
    cd "$PROJECT_ROOT/frontend"
    npm run watch &
    WATCH_PID=$!

    # Function to copy files when frontend builds
    copy_on_change() {
        while inotifywait -r -e modify,create,delete,move \
            "$PROJECT_ROOT/frontend/dist" 2>/dev/null; do
            echo "Frontend changed, copying to backend..."
            mkdir -p "$PROJECT_ROOT/backend/static"
            cp -r "$PROJECT_ROOT/frontend/dist/"* "$PROJECT_ROOT/backend/static/"
            echo "Copied!"
        done
    }

    # Start file watcher
    if command -v inotifywait &> /dev/null; then
        copy_on_change &
        COPY_PID=$!
    fi

    # Start backend in foreground
    cd "$PROJECT_ROOT/backend"
    python main.py

    # Cleanup on exit
    kill $WATCH_PID 2>/dev/null
    kill $COPY_PID 2>/dev/null
else
    # Start the server
    echo ""
    echo "Starting server at http://127.0.0.1:8000"
    echo "Press Ctrl+C to stop"
    echo ""

    cd "$PROJECT_ROOT/backend"
    python main.py
fi
