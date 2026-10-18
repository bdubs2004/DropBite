# Prompt for the website chat: privacy page update (analytics)

Paste everything below the line into the chat that builds niblgo.com.

---

Please update the Privacy Policy page on niblgo.com (the page at /privacy) with
these changes, keeping the existing design, wording style and everything else
as it is. No em dashes in the copy.

1. Dates at the top: "Last updated: 18 October 2026 · Effective: 25 October 2026".

2. Section 1 "The short version", replace the bullet that starts "We show no
   ads, we run no analytics or tracking SDKs" with:

   "We show no ads, we use no third-party analytics or tracking SDKs, and we
   never sell your data. There is no advertising identifier, no third-party
   tracker, and no cross-app or cross-site tracking of any kind in NiblGo. We do
   keep our own simple record of how the app is used (section 2), only to
   understand and improve NiblGo; it stays with us and is deleted with your
   account."

3. Section 2, the "Collected automatically" table: add this row after "Your
   posting streak":

   | How you use the app | When you open the app, which posts by other people appeared on your screen, which recipes on other people's posts you opened, recipe cards you made, invites you shared, and the invite code you entered at sign-up. Linked to your account and used only to understand and improve NiblGo (for example, how many people come back after a week). We look at it in reporting software on our own computers, as account ids, dates and counts, never with your name, email or what you wrote. Never used for ads or shared with anyone else |

4. Section 2, "We do not collect": change the last sentence to "NiblGo has no
   ads, no in-app purchases, and no third-party analytics."

5. Section 8 "How long we keep things": add this row after "Account, posts,
   photos, messages":

   | How you use the app (app opens, posts you saw, recipes opened, invites) | Until you delete your account |

Then rebuild the site and give me the deploy zip.
