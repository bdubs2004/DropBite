# NiblGo Power BI report: the four pages

Every measure named here is in `measures.dax`. Before building, add a
**report-level filter** (Filters pane → "Filters on all pages") of
`dim_users[is_test]` = **False**, so test accounts never count anywhere.
Add a **date slicer** on `'Calendar'[Date]` to pages 1 and 3; the "as of"
numbers (WAU, 7-day counts) follow its end date.

## Page 1: Overview (the 10 KPIs)

Two rows of five **Card** visuals:

| # | Card | Measure |
| --- | --- | --- |
| 1 | Total signups | `Total signups` |
| 2 | New signups (7 days) | `New signups (7 days)` |
| 3 | WAU | `WAU` |
| 4 | Activation rate | `Activation rate` (format as %) |
| 5 | D7 retention | `D7 retention` (%) |
| 6 | Meals posted (7 days) | `Meals posted (7 days)` |
| 7 | Posts per active user | `Posts per active user` (1 decimal) |
| 8 | Recipe save rate | `Recipe save rate` (%) |
| 9 | Referral signup rate | `Referral signup rate` (%) |
| 10 | Stranger D7 retention | `Stranger D7 retention` (%) |

Below them, two **line charts**, X axis `'Calendar'[Date]`:
- `DAU` and `WAU`.
- `Signups` and `Meals posted`.

Small print under the cards (a Text box): "Activation: first meal within 7 days,
of people who signed up 7+ days ago. D7: active on any day 7-13 after signing
up, mature cohorts only. Stranger: relationship = independent."

## Page 2: User funnel

A **Funnel** visual with the six funnel measures, in order:
`Funnel 1 signed up` → `Funnel 2 verified email` → `Funnel 3 viewed a meal` →
`Funnel 4 first post` → `Funnel 5 came back` → `Funnel 6 repeat post`.

Next to it: **Card** `Median hours to first post`, **Card** `Verified rate`,
and a **Clustered bar** of `Activation rate` by `dim_users[relationship]`
(are strangers posting like friends do?).

Slicers: `dim_users[signup_week]`, `dim_users[acquisition_source]`,
`dim_users[relationship]`, `dim_users[campus]`.

## Page 3: Engagement and retention

- **Line chart**: `DAU`, `WAU` by `'Calendar'[Date]`.
- **Column chart**: `Meals posted`, `Recipe cards generated`, `Saves`,
  `Likes`, `Comments` by `'Calendar'[Date]` (set the axis to week).
- **Line chart** from `kpi_weekly`: X `week_start`, values
  `Weekly returning rate` and `Weekly posting rate`.
- **Cards**: `D1 retention`, `D7 retention`, `D30 retention`,
  `Repeat posting rate`.
- **Cohort heatmap**: a **Matrix**, rows `dim_users[signup_week]`, values
  `Total signups`, `D1 retention`, `D7 retention`, `D30 retention`; turn on
  conditional formatting → background colour (minimum cream, maximum amber
  comes from the theme). Blank cells are cohorts too young to measure.
- **Matrix**: rows `dim_users[acquisition_source]`, values `D7 retention`,
  `Activation rate` (retention by source).

## Page 4: Growth and sources

- **Clustered bar**: `Total signups` and `Activation rate` by
  `dim_users[acquisition_source]`.
- **Clustered bar**: the same by `dim_users[campus]`.
- **Clustered bar**: the same by `dim_users[relationship]`.
- **Cards**: `Invites sent`, `Referral signups`, `Referral signup rate`.
- **Line chart**: `Invites sent` and `Referral signups` by week.
- Placeholder **Text box**: "Spend, cost per signup and cost per activated
  user arrive with paid campaigns" (see docs/ANALYTICS.md, "Later").
