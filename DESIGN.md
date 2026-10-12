# UI v1 · Wise-inspired

Reference: https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/wise/DESIGN.md

This is an adaptation for the mandatory-report demo, using the reference's lime accent, sage canvas, dark ink, rounded surfaces and clear typographic hierarchy.

## Tokens

- Primary action: `#9fe870`; hover: `#b5f28e`.
- Canvas: `#e8ebe6`; cards: white; secondary surface: `#f5f7f2`.
- Heading/action ink: `#163300`; body: `#51594c`.
- Card radius: 24px; input radius: 12px; buttons: pills.
- Chinese text uses installed system fonts; no proprietary font assets are bundled.

## Page structure

- Public service: left navigation for questions, training, learning, reporting, records and unit ledgers, with fictional demo role selection.
- Report: a three-section form, a link to real AI conversation, and local receipt history.
- Receiver: department sidebar, four summary metrics, searchable queue, distributions, collapsible audit log, and a native case detail dialog.
- Red means risk/overdue/error. Anonymous reports use neutral styling.
- Responsive layout: stacked public form and assistant on phones, horizontal department navigation, and horizontally scrollable data tables.
- Real AI serves public conversations, training characters and feedback. Receiver assessment remains a rule demonstration with human confirmation.
- Training forms persist through the backend; simulated reports never enter the police queue. Unit exports contain completion and scoring summaries.

## Iterate

Adjust shared colors, spacing, font sizes and radii in `public/style.css`. Keep public reporting and internal processing visually consistent. Check desktop and phone layouts after structural changes.
