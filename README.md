# Magic Snake Workbench

A browser-based 3D editor and player for designing Rubik's Snake shapes. It supports 24, 36, 48, and 72-piece snakes and runs entirely on the client side.

[Live demo](https://regomne.github.io/magic-snake/)

![Magic Snake Workbench](public/magic-snake-workbench.png)

## Features

- Select pieces in the 3D view and rotate their joints
- Enter and convert between 0123 pose encoding, speed-solving notation, and parenthesized formulas
- Browse built-in shapes and play their folding sequences step by step
- Choose classic or rainbow colors, or create a custom cyclic color palette
- Detect overlapping pieces in the final pose using exact geometry
- Automatically frame shapes during playback, reset the view to the current shape, and use unrestricted inertial orbit controls
- Share the current shape through the URL hash
- Switch between Chinese and English interfaces

## Local development

Node.js and npm are required.

```bash
npm install
npm run dev
```

Open the local address shown in the terminal.

## Checks and production build

```bash
npm run lint
npm test
npm run build
```
