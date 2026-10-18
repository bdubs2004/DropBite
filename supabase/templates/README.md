# Auth email templates

Paste these into Supabase → **Authentication → Emails → Templates** (the
"Message body" box, in source/HTML view). Supabase fills in the `{{ ... }}`
parts when it sends.

| Template | Subject | File |
| --- | --- | --- |
| Confirm signup | `Confirm your NiblGo email` | `confirm-signup.html` |
| Reset password | `Reset your NiblGo password` | `reset-password.html` |

**Why the reset email doesn't use `{{ .ConfirmationURL }}`.** That link spends
the one-time code the moment anything opens it: an email app's link scanner or
preview, or a second tap, leaves the person with "This reset link has expired".
The reset template links to niblgo.com/auth/reset with the code
(`{{ .TokenHash }}`) after the `#`, which never reaches a server and is used up
only when the person taps "Set a new password" on that page (the page swaps it
at Supabase and hands the app a session). `scripts/build-site.js` builds the
page; `supabase/tests/e2e` sends this exact template through the real Auth
server and follows it (section 12).
