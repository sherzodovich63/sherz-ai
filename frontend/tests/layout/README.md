Real-browser check of the chat layout (no Next.js needed).

    npm i -D react react-dom esbuild playwright-core   # and: npx playwright-core install chromium
    mkdir -p out && npx esbuild entry.jsx --bundle --outfile=out/app.js --jsx=automatic --loader:.js=jsx \
      --alias:react=$PWD/node_modules/react --alias:react-dom=$PWD/node_modules/react-dom \
      --define:process.env.NODE_ENV='"development"' --define:process.env.NEXT_PUBLIC_API_URL='""'
    cp index.html out/index.html
    node run.mjs

Checks (desktop + mobile viewport): page never scrolls, only the thread does, starts at newest message,
composer stays on screen, lazy-loads older pages, keeps scroll position after prepend, streamed reply stays visible.
