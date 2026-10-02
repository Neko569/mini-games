import { place } from '../src/planes.js';
console.log('W =', (await import('../src/planes.js')).W);
try { console.log(JSON.stringify(place([{ x: 5, y: 2, rot: 0 }]))); } catch (e) { console.log('ERR:', e.message); }
