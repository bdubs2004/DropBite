/**
 * Password requirement rules.
 *
 * Run with: npm run test:password
 */
import { passwordChecks, passwordMeetsAll } from '../passwordRules';

let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
}

check('a strong password passes all rules', passwordMeetsAll('Tacos123!'));
check('too short fails', !passwordMeetsAll('Ta1!'));
check('no number fails', !passwordMeetsAll('tacotacos!'));
check('no special character fails', !passwordMeetsAll('tacotacos1'));
check('various specials count', passwordMeetsAll('password9@'));
check('percent counts', passwordMeetsAll('password9%'));
check('dollar counts', passwordMeetsAll('password9$'));

const checks = passwordChecks('taco');
check('checklist reports length unmet for short', checks.find((c) => c.key === 'length')!.met === false);
check('checklist reports number unmet', checks.find((c) => c.key === 'number')!.met === false);
check('checklist reports special unmet', checks.find((c) => c.key === 'special')!.met === false);

const ok = passwordChecks('Tacos123!');
check('checklist all met for strong', ok.every((c) => c.met));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
