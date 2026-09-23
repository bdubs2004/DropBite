/**
 * Substantial-description-change heuristic.
 *
 * Run with: npm run test:textchange
 *
 * The point is that a small edit (a typo fix, one extra ingredient) must NOT
 * nag the user to rebuild their recipe card, while a genuine rewrite must.
 */
import { isSubstantialChange } from '../textChange';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

// Quiet on no change / trivial edits.
check('identical text is not substantial', !isSubstantialChange('chicken with garlic', 'chicken with garlic'));
check('a one-word addition is not substantial',
  !isSubstantialChange('seared chicken thighs with garlic', 'seared chicken thighs with garlic butter'));
check('a typo fix is not substantial',
  !isSubstantialChange('creamy pasta with parmesan', 'creamy pasta with parmesean'));

// Fires on a real rewrite.
check('a full rewrite is substantial',
  isSubstantialChange('chicken thighs with garlic', 'beef stew with potatoes and carrots'));
check('swapping the dish is substantial',
  isSubstantialChange('banana bread with walnuts', 'a simple green salad with vinaigrette'));

// Edge: clearing most of it, or going from empty to text.
check('clearing most of the text is substantial',
  isSubstantialChange('roasted chicken with garlic butter and rosemary potatoes', 'chicken'));
check('empty to text is substantial', isSubstantialChange('', 'chicken alfredo'));
check('empty to empty is not substantial', !isSubstantialChange('', ''));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
