/**
 * Collection name rules.
 *
 * Run with: npm run test:collections
 */
import { collectionNameProblem, tidyCollectionName } from '../collectionName';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

check('trims and collapses spaces', tidyCollectionName('  Crockpot   meals ') === 'Crockpot meals');
check('a normal name is fine', collectionNameProblem('Desserts') === null);
check('blank is rejected', collectionNameProblem('   ') !== null);
check('too long is rejected', collectionNameProblem('x'.repeat(41)) !== null);
check('40 characters is allowed', collectionNameProblem('x'.repeat(40)) === null);
check('a duplicate is rejected, ignoring case', collectionNameProblem('desserts', ['Desserts']) !== null);
check('a duplicate is rejected, ignoring extra spaces', collectionNameProblem(' Crockpot  meals', ['Crockpot meals']) !== null);
check('a different name is fine', collectionNameProblem('Soups', ['Desserts']) === null);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
