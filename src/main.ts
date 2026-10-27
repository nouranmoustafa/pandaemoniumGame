import { Game } from './core/Game';

const params = new URLSearchParams(location.search);
const startX = params.has('x') ? Number(params.get('x')) : undefined;

const game = new Game(document.getElementById('app')!, { startX });

// Handy for debugging and automated smoke tests.
(window as unknown as { __game: Game }).__game = game;
