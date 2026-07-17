# Tabi — Project Brief for Claude Code

Working title: **Tabi** (旅, "journey" in Japanese). A trip planner built around the traveler's actual route, not a generic guide — travel time between bookings drives the schedule, not the other way around.

## Product summary
- Users import/enter their fixed bookings (stay, transport, activities).
- The app computes real travel time between them and shows what's actually free time vs. busy time per day.
- Every booking-type item has a 3-state status: **Booked / To book / Decide later** — nothing is ever an ambiguous blank.
- Accommodation coverage gaps (nights with nothing booked) are actively detected and surfaced, not hidden.

## Tech stack (decided)
- **Frontend**: Web app (PWA), mobile-first, installable to iOS home screen. No native app for V0.5 — avoids App Store review cycle.
- **Hosting**: Vercel (project "tabi" already created — team `jguerrero-2639s-projects`).
- **Backend / DB**: Supabase, PostgreSQL + Auth (project "Tabi" already created — ref `czyeohubhsqiumhpodbc`, region eu-west-1).
- **Auth**: Supabase anonymous sessions from first launch (no login screen in V0.5), upgradable to a real account later without data loss.
- **Geocoding & travel time**: Google Maps Platform (Geocoding + Directions/Distance Matrix + Time Zone API).
- **Places, ratings, reviews**: Google Places API.
- **Import parsing (V1+)**: Claude API (multimodal — handles email text, PDF, and photos of tickets/receipts through the same extraction pipeline).
- **Reminders (V1+)**: Resend (email) + Vercel Cron for scheduled checks.

## Architecture principles (non-negotiable, decided early to avoid rework)

1. **Multi-trip from day one.** Every reservation belongs to a "Trip"; a user can have many trips. Don't build a single-trip-implicit model.

2. **UTC storage + per-location timezone.** All timestamps stored in UTC; each location has a timezone (via Google Time Zone API). All duration math (travel time, free blocks) happens in UTC — never subtract displayed local times directly. Display converts to the relevant local timezone per leg (departure tz vs arrival tz), switching reference at actual arrival, not departure.

3. **Country-agnostic.** No hardcoded country/city/provider logic (e.g. no JR Pass–specific code). Anything country-specific is data/config, never code.

4. **AI never invents facts.** LLMs translate user intent into structured filters/extractions sent to real APIs (Google Places, etc.) — never generate place suggestions or factual claims from general knowledge. Avoids hallucinated/closed venues.

5. **AI is action-triggered, never an open chat.** No general-purpose chatbot in the app. Every AI usage is a bounded, specific action (extract a reservation, translate a search query into filters, generate a place description) with a predictable token cost. This is the core cost-control strategy — no open-ended conversation that could run up unpredictable bills. A "bring your own LLM key" option for power users is a possible later (V2) addition, not built now.

6. **Shared UI templates.** One menu template (header + "+" button top-right + list-row: icon/title/status) reused across Stay, Transport, Activities, Budget — not rebuilt per screen. One shared "Add" bottom sheet (type selector first, conditional fields) for all booking types. One shared detail screen for all item types. One shared quick-add sheet for free time blocks (browse activities vs. custom block).

7. **Date-grouped lists, not date-in-subtitle.** List menus group items under date/period headers so gaps are visually obvious (critical for Stay — an uncovered date range must show as its own flagged section, not a silent absence). Accommodation coverage gaps are computed and surfaced explicitly.

8. **UI text centralized** (i18n-ready) — English is the default and only display language for now, but strings aren't hardcoded per-screen, to allow adding languages later without rewrites.

9. **Role model ready for multi-person use.** A trip has an Organizer (full access) and can have Travelers (real account, scoped access). This also makes the app viable for someone planning trips on behalf of others, and — longer-term — a travel-agency-style use case (multiple organizer accounts sharing a client trip portfolio), without needing rework. Confirmed via explicit compatibility audit — no conflicts found with the rest of the architecture.

10. **Row Level Security (RLS) enforced at the database level, from the initial schema.** Every table holding trip data (Trip, Reservation, Activity, Notes, etc.) must have RLS policies restricting access to the trip's Organizer and invited Travelers — enforced by Postgres itself, not just filtered in application code. Set this up alongside the very first schema migration, not retrofitted later.

11. **API keys never exposed client-side.** All calls to external APIs (Claude, Google Maps/Places, Resend) go through server-side functions (Supabase Edge Functions or Vercel Functions). No key ever ships in client-side JS.

12. **Per-user rate limits on AI and external API calls.** Even server-side, cap usage per user/day to avoid runaway costs from bugs or abuse.

13. **Validate AI output before writing to the database.** Structured extraction results (reservation fields, search filters) must be validated against an expected schema before being persisted — never trust LLM JSON output blindly. This is in addition to (not a replacement for) the human verification screen shown before saving an imported reservation.

14. **Treat imported document content as untrusted data, not instructions.** Extraction prompts for emails/PDFs/photos must be designed so that text inside the document can never be interpreted as instructions to the model (prompt injection defense).

15. **Entitlements layer, decoupled from billing, from day one.** Each account has a `plan` field (default: free, no real payment wired up yet). A central config maps plan → enabled features and numeric limits (e.g. AI access, inviting Travelers, max active trips, max trip duration). No feature ever checks the plan directly — everything goes through a central entitlement check, verified both client-side (UI) and server-side (actual enforcement — same "never trust the client alone" principle as the security rules above). When real billing is wired up later, only the `plan` update mechanism changes; no feature code needs to change.

## V0.5 priority backlog (build this first — see Notion "Backlog" database for the full list, IDs prefixed `TABI-`)
- Row Level Security policies (set up with the very first schema migration)
- Entitlements layer foundation (plan field + central config) — even with no paid features yet
- Trip data model (multi-trip) + anonymous Supabase auth
- Trips list screen (home) + create-trip form
- Manual reservation entry form (type, name, address, dates, price, 3-state status, note)
- Geocoding + travel-time integration (keys server-side only)
- Timeline generation with free-time-block calculation (UTC-based)
- Overview screen: map (tap to fullscreen) + "Needs attention" action list (bookings to make + dated reminders, sorted by urgency) — NOT a full duplicate list of every reservation
- Stay / Transport / Activities menus using the shared list template, grouped by date
- Accommodation coverage-gap detection (flag uncovered nights explicitly)
- Shared detail screen (view/edit any item type)
- Shared "Add" bottom sheet
- Check-in deadline + parking flags for Stay items

## Explicitly out of scope for V0.5
Email/PDF/photo import parsing, Google Places suggestions/bookmarking, budget aggregation, notifications/reminders, multi-person sharing, offline mode, natural-language search, anecdotes/journal features, actual plan gating (the entitlements *layer* is V0.5, but no feature actually restricted yet). These are real, tracked in the Notion Backlog under later phases (V1 / V1.5 / V2) — don't build them now, but don't design V0.5 in a way that blocks them either.

## Source of truth
Full backlog, decision history, and reasoning for every choice above live in Notion: pages **"Tabi — Product Strategy"**, **"Decision Log"**, and **"Backlog"** (items have short IDs like `TABI-12` for easy reference). When in doubt about *why* something is built a certain way, that's where the reasoning is — ask the user to paste the relevant entry if needed.