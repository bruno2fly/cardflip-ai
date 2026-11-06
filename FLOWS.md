# Main flows — CardFlip AI (bot hub rebuild, Nov 6 2026)

## Buy Bot page (/bot) — mission control
- Start: /bot
- Expect: status strip with 4 cards (Bot Agents, Master Arm, Next Fast-Poll Window with live countdown, Orders)
- "Add Any Target Product": paste a target.com link (…/A-1012850573) → "Look up" → preview card with image, name, IN/OUT OF STOCK badge, price → price cap field + auto-buy toggle → "Add to bot" → success message, item appears in Auto-Buy Targets
- Drops Radar: event cards with TYPE badges (STREET DATE / OVERNIGHT RESTOCK / DRAWING / INVITE / QUEUE), live countdown ("in 2d 3h"), note text; products with "Arm to bot" button or "on watchlist"
- Fast-Poll Windows: list of scheduled windows with countdown, add/remove window form (from/to/poll every)
- Auto-Buy Targets: list with image thumbnails, Buy now button, auto-buy toggle
- Order Feed: order rows with status chips (queued/running/ordered/failed)
- Checkout Profile: bot selector (2 bots), masked card, "Send profile" expands the zero-knowledge encryption form
- "Notify me" button in header enables browser notifications; new order results fire a notification while page is open

## Existing flows that must keep working
- Master Arm toggle → ARMED/DISARMED (writes bot_config)
- Buy now on a target → queues manual order in bot_orders
- Auto-buy toggles on targets → watchlist auto_buy column
- Schedule window → drop_windows saved, "FAST POLLING NOW" banner appears while inside a window
- /restocks (Drops page) → renders drop events with countdown + Track buttons (unchanged)
- /drops (Buy Now page) → in-stock listings (unchanged)
- Sidebar: Buy Bot is now the FIRST item, then Drops, Buy Now
- Bot agents (bridge on both machines) call /api/bot/agent actions: heartbeat, config (armed + targets + dropWindows), claim — unchanged
- /api/bot/resolve-product and /api/bot/add-target are NEW; no existing client depends on them

## Requested-change checks
- "main thing is the BOT page" → Buy Bot first in sidebar; /bot restructured as hub
- "drops infos + notification what type drops" → Drops Radar section with type badges + countdowns; browser notifications for order results
- "easy way to add products direct in the web" → Add Any Target Product flow (paste URL → lookup → cap → arm)
