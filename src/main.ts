import { COURSE } from './config';
import { Game } from './core/Game';

const params = new URLSearchParams(location.search);
// ?house starts at the foot of the porch, so the Stage 4 sequence begins at once.
const startX = params.has('house') ? COURSE.finish + 2 : params.has('x') ? Number(params.get('x')) : undefined;

if (params.has('lab')) {
  // Development: the cast under studio light.
  void import('./dev/CharacterLab').then(({ CharacterLab }) => new CharacterLab(document.getElementById('app')!));
} else {
  const game = new Game(document.getElementById('app')!, { startX, skipIntro: params.has('skipintro') });
  // Handy for debugging and automated smoke tests.
  (window as unknown as { __game: Game }).__game = game;
}
