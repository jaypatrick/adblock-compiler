import { Wildcard } from './src/utils/Wildcard.ts';

// Test 1: example.* should match ||example.com^
const w1 = new Wildcard('example.*');
console.log('Pattern:', w1.pattern);
console.log('isWildcard:', w1.isWildcard);
console.log('isPlain:', w1.isPlain);
console.log('Test ||example.com^:', w1.test('||example.com^'));
console.log('Test ||example.org^:', w1.test('||example.org^'));
console.log('Test ||test.com^:', w1.test('||test.com^'));
console.log('');

// Test 2: test.com should match ||test.com^
const w2 = new Wildcard('test.com');
console.log('Pattern:', w2.pattern);
console.log('isPlain:', w2.isPlain);
console.log('Test ||test.com^:', w2.test('||test.com^'));
console.log('');

// Test 3: domain.* should match ||domain.org^
const w3 = new Wildcard('domain.*');
console.log('Pattern:', w3.pattern);
console.log('isWildcard:', w3.isWildcard);
console.log('Test ||domain.org^:', w3.test('||domain.org^'));
