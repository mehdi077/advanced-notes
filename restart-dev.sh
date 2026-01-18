#!/bin/bash

# Kill any running Next.js dev servers
echo "Stopping any running dev servers..."
pkill -f "next dev"
sleep 2

# Start the dev server
echo "Starting dev server..."
npm run dev
