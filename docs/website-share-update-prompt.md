# Website: shared post links, /get and universal links

The live site's `_worker.js` was found not running (niblgo.com/post/..., /get and
/.well-known/apple-app-site-association all answered 404 while the static
`_redirects` rules worked). So the site now gets the same features as plain
static files, which work whether or not the worker runs:

- `website/post.html`: the share page, built by `scripts/build-site.js` from the
  worker's own page code and filled in by the browser.
- `website/.well-known/apple-app-site-association`: universal links for `/post/*`
  (Team ID 2QQPTNNN28).
- `website/_redirects.niblgo`: lines for the top of the site's `_redirects`
  (`/get` to TestFlight, `/download`, `/app`, and `/post/* /post 200`).

The worker (`website/_worker.js`) stays: where it runs it wins, and link previews
then show the food photo instead of the NiblGo card.

To publish: give the website chat those three files (the prompt in the chat
transcript has them inline) and ask it to keep `_worker.js` at the zip root.
After deploying, check:
- https://niblgo.com/get goes to TestFlight
- https://niblgo.com/.well-known/apple-app-site-association shows JSON with
  `2QQPTNNN28.com.niblgo.app`
- https://niblgo.com/post/00000000-0000-4000-8000-000000000000 says "This post
  isn't available"
