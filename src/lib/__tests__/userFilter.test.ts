/**
 * Followers / following search.
 *
 * Run with: npm run test:userfilter
 */
import { User } from '../../types';
import { filterUsers } from '../userFilter';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

const u = (id: string, display_name: string, handle: string) =>
  ({ id, display_name, handle }) as User;
const people = [
  u('1', 'Marge Halvorson', 'margesbakes'),
  u('2', 'Dan Okafor', 'smokedan'),
  u('3', 'José Ramírez', 'josecooks'),
];
const ids = (list: User[]) => list.map((x) => x.id).join(',');

check('empty search keeps everyone in order', ids(filterUsers(people, '')) === '1,2,3');
check('spaces only keeps everyone', ids(filterUsers(people, '   ')) === '1,2,3');
check('matches the start of a name', ids(filterUsers(people, 'mar')) === '1');
check('matches inside a name', ids(filterUsers(people, 'halv')) === '1');
check('ignores capitals', ids(filterUsers(people, 'DAN')) === '2');
check('matches a handle', ids(filterUsers(people, 'smoke')) === '2');
check('a leading @ is fine', ids(filterUsers(people, '@margesbakes')) === '1');
check('accents are ignored both ways', ids(filterUsers(people, 'jose ramirez')) === '3');
check('no match gives an empty list', filterUsers(people, 'zzz').length === 0);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
