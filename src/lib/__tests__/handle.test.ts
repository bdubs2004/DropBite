/**
 * Handles keep their capitals.
 *
 * Run with: npm run test:handle
 */
import { cleanHandle, isReservedHandle, sameHandle, unreservedBase } from '../handle';

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

// Staff-looking handles (migration 0035).
check('admin is reserved, any capitals', isReservedHandle('Admin') && isReservedHandle('ADMIN'));
check('anything with niblgo is reserved', isReservedHandle('NiblGo_Support') && isReservedHandle('realniblgo'));
check('ordinary handles are not', !isReservedHandle('JoeMama') && !isReservedHandle('admin2') && !isReservedHandle('supportive'));
check('a reserved word comes out of the starting point', unreservedBase('niblgofan') === 'fan', unreservedBase('niblgofan'));
check('nothing left means "user"', unreservedBase('niblgo') === 'user' && unreservedBase('admin') === 'user');
check('an ordinary handle is left alone', unreservedBase('JoeMama') === 'JoeMama');
check('numbers added on a clash never make it reserved', !isReservedHandle(unreservedBase('niblgo') + '1234'));
{
  // The app's list must match the database's, or sign-up says yes and the
  // database says no. Read the SQL list straight from the migration.
  const fs = require('fs');
  const path = require('path');
  const sql: string = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0035_abuse_limits.sql'), 'utf8');
  const block = sql.slice(sql.indexOf('lower(h) in ('), sql.indexOf(');', sql.indexOf('lower(h) in (')));
  const words: string[] = (block.match(/'([a-z_]+)'/g) ?? []).map((w: string) => w.slice(1, -1));
  const mismatched = words.filter((w) => !isReservedHandle(w));
  check(`the app reserves every handle the database does (${words.length})`, words.length > 40 && mismatched.length === 0, mismatched.join(','));
}

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASSED');
