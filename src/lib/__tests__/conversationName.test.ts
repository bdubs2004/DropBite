/**
 * DM thread title, from the viewer's perspective.
 *
 * Run with: npm run test:convname
 */
import { conversationTitle, isGroupConversation } from '../conversationName';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

check(
  'one other person is just their name',
  conversationTitle([{ display_name: 'Alice' }]) === 'Alice',
);
check(
  'two others join with an ampersand',
  conversationTitle([{ display_name: 'Alice' }, { display_name: 'Bob' }]) === 'Alice & Bob',
);
check(
  'three others use a comma then ampersand',
  conversationTitle([
    { display_name: 'Alice' },
    { display_name: 'Bob' },
    { display_name: 'Carol' },
  ]) === 'Alice, Bob & Carol',
);
check(
  'four or more trims to two names plus a count',
  conversationTitle([
    { display_name: 'Alice' },
    { display_name: 'Bob' },
    { display_name: 'Carol' },
    { display_name: 'Dan' },
  ]) === 'Alice, Bob +2',
);
check(
  'falls back to the handle when there is no display name',
  conversationTitle([{ display_name: '', handle: 'ally' }]) === '@ally',
);
check(
  'falls back to Someone when there is nothing',
  conversationTitle([{}]) === 'Someone',
);
check('no members reads as Someone', conversationTitle([]) === 'Someone');

check('one other is not a group', !isGroupConversation(1));
check('two others is a group', isGroupConversation(2));
check('zero others is not a group', !isGroupConversation(0));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
