import { place, strike, newGame } from '../src/planes.js';
const sol = [{ x: 0, y: 2, rot: 3 }, { x: 0, y: 7, rot: 3 }, { x: 3, y: 4, rot: 3 }];
const g = newGame();
g.boards[1] = place(sol);
g.phase = 'fighting';
console.log('plane1 head:', g.boards[1][0].head, 'cells:', JSON.stringify(g.boards[1][0].cells));
console.log('plane2 head:', g.boards[1][1].head);
console.log('plane3 head:', g.boards[1][2].head);
console.log('strike(0,2) =', strike(g, 0, 0, 2));
