// What a share out of the app says (src/lib/shareText.ts) and how a shared
// link is read back (src/lib/links.ts).
import { inviteMessage, possessive, postShareTitle, postShareUrl, smsUrl } from '../shareText';
import { postLinkFrom } from '../links';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — got: ${JSON.stringify(got)}`}`);
}

const ID = '10000000-0000-4000-8000-0000000000a1';
const user = (display_name: string, handle = 'bdubs2004') => ({ id: 'u', display_name, handle } as any);

check('a post shares as "whose meal on NiblGo"', postShareTitle({ meal_slot: 'dinner', user: user('Bryce') }) === 'Bryce’s dinner on NiblGo', postShareTitle({ meal_slot: 'dinner', user: user('Bryce') }));
check('names ending in s read right', possessive('Marcus') === 'Marcus’');
check('no display name: the handle', postShareTitle({ meal_slot: 'snack', user: user('', 'ann') }) === '@ann’s snack on NiblGo');
check('no person at all: a plain title', postShareTitle({ meal_slot: 'lunch' } as any) === 'A meal on NiblGo');

check('the link names the sharer, for the invite code', postShareUrl(ID, 'bdubs2004') === `https://niblgo.com/post/${ID}?from=bdubs2004`, postShareUrl(ID, 'bdubs2004'));
check('no handle, no ?from', postShareUrl(ID) === `https://niblgo.com/post/${ID}`);
check('a handle that isn\'t one is left off', postShareUrl(ID, 'a b<c>') === `https://niblgo.com/post/${ID}`);

const invite = inviteMessage('bdubs2004');
check('an invite has the one download link and the code', invite.includes('https://niblgo.com/get') && invite.includes('@bdubs2004 as your invite code'), invite);
check('no em dashes in what people receive', !/—/.test(invite));

check('Messages link on iPhone', smsUrl('hi there & you', 'ios') === 'sms:&body=hi%20there%20%26%20you');
check('Messages link on Android', smsUrl('hi', 'android') === 'sms:?body=hi');

// Reading a shared link back
const a = postLinkFrom(`https://niblgo.com/post/${ID}?from=margesbakes`);
check('a website link: the post and who shared it', a?.postId === ID && a?.from === 'margesbakes', a);
const b = postLinkFrom(`niblgo://post/${ID}`);
check('an app link: the post, no sharer', b?.postId === ID && b?.from === null, b);
check('a web-build path works too', postLinkFrom(`/post/${ID}`)?.postId === ID);
check('a sharer that isn\'t a handle is dropped', postLinkFrom(`https://niblgo.com/post/${ID}?from=%3Cx%3E`)?.from === null);
check('a post id that isn\'t one is ignored', postLinkFrom('https://niblgo.com/post/../../etc') === null);
check('other links aren\'t posts', postLinkFrom('niblgo://reset#access_token=x') === null && postLinkFrom('https://niblgo.com/auth/confirm') === null);
check('nothing at all', postLinkFrom('') === null && postLinkFrom(null) === null);

console.log(failed ? `\n${failed} share check(s) failed` : '\nAll share checks passed');
if (failed) process.exit(1);
