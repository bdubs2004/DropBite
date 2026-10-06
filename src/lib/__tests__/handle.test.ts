/**
 * Handles keep their capitals.
 *
 * Run with: npm run test:handle
 */
import { cleanHandle, sameHandle } from '../handle';

let failures = 0;
function check(label: string, pass: boolean, got?: string) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  — ${got}` : ''}`);
}

check('capitals are kept', cleanHandle('JoeMama') === 'JoeMama', cleanHandle('JoeMama'));
check('mixed case with numbers and underscores', cleanHandle('Big_Chef99') === 'Big_Chef99', cleanHandle('Big_Chef99'));
check('spaces and symbols are dropped', cleanHandle('  Joe Mama!! ') === 'JoeMama', cleanHandle('  Joe Mama!! '));
check('a leading @ is dropped', cleanHandle('@JoeMama') === 'JoeMama', cleanHandle('@JoeMama'));
check('accented letters are dropped, not lowercased', cleanHandle('JoséEats') === 'JosEats', cleanHandle('JoséEats'));
check('cut to 30 characters', cleanHandle('A'.repeat(40)).length === 30);
check('all lowercase still works', cleanHandle('joemama') === 'joemama');
check('JoeMama and joemama are the same handle', sameHandle('JoeMama', 'joemama'));
check('different handles are different', !sameHandle('JoeMama', 'JoeMama2'));

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
