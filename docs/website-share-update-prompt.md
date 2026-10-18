# Prompt for the website chat: shared post page, /get, universal links

Upload `website/_worker.js` from the repo to the chat that builds niblgo.com,
then paste everything below the line.

---

Please replace the site's `_worker.js` with the attached `_worker.js`, exactly
as it is, and give me a new deploy zip. Nothing else on the site changes.

What the new worker does (so you can check nothing you added since is lost):

- It keeps everything the current worker does: the same redirects (`/auth`,
  `/beta-tester`, `/betatester`, `/thanks`, `/legal`, `/help`, `/contact`),
  trailing-slash and `.html` clean-ups, and the same security and cache
  headers on every static page.
- `/post/<id>`: a redesigned page for shared posts. The poster's photo and
  name, when it was posted, the meal photo, the caption, price and hashtags, a
  recipe teaser, "Open in NiblGo" and "New here? Get NiblGo" on iPhone, a
  beta sign-up link on Android and computers, the sharer's invite code, and a
  proper page when a post was deleted. Light and dark mode.
- New `/get` (and `/download`, `/app`): redirects to the TestFlight link. At
  App Store launch only the `DOWNLOAD_URL` line at the top changes.
- New `/.well-known/apple-app-site-association`, served as JSON by the worker
  itself (no file needed). It lets iPhones open niblgo.com/post links straight
  in the app.

If the site has changed since my last zip in a way that touches `_worker.js`
(a new redirect, say), merge that into the attached file instead of dropping
it, and tell me what you merged.

After deploying, these should all work:
- https://niblgo.com/get sends you to TestFlight
- https://niblgo.com/.well-known/apple-app-site-association shows JSON with
  `2QQPTNNN28.com.niblgo.app`
- https://niblgo.com/post/00000000-0000-4000-8000-000000000000 shows "This
  post isn't available"
