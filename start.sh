#!/bin/bash
cd "$(dirname "$0")"

# Start Python server in background
python3 server.py &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Open Andy as standalone PWA-style window in Chrome
if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" --args --app=http://localhost:3000
elif [ -d "$HOME/Applications/Google Chrome.app" ]; then
    open -a "$HOME/Applications/Google Chrome.app" --args --app=http://localhost:3000
else
    # Chrome not found — open in default browser
    open http://localhost:3000
fi

# Keep terminal open so server keeps running
wait $SERVER_PID
