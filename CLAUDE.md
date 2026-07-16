# Tabi — Project Brief for Claude Code

Working title: **Tabi** (旅, "journey" in Japanese). A trip planner built around the traveler's actual route, not a generic guide — travel time between bookings drives the schedule, not the other way around.

## Product summary
- Users import/enter their fixed bookings (stay, transport, activities).
- The app computes real travel time between them and shows what's actually free time vs. busy time per day.
- Every booking-type item has a 3-state status: **Booked / To book / Decide later** — nothing is ever an ambiguous blank.
- Accommodation coverage gaps (nights with nothing booked) are actively detected and surfaced, not hidden.

## Tech stack (decided)
- **Frontend**: Web app (PWA), mobile-first, installable to iOS home screen. No native app for V0.5 — avoids App Store review cycle.
- **Hosting**: Vercel.
- **Backend / DB**: Supabase (PostgreSQL + Auth).
- **Auth**: Supabase anonymous sessions from first launch (no login screen in V0.5), upgradable to a real account later without data loss.
- **Geocoding & travel time**: Google Maps Platform (Geocoding + Directions/Distance Matrix + Time Zone API).
- **Places, ratings, reviews**: Google Places API.
- **Import parsing (V1+)**: Claude API (multimodal — handles email text, PDF, and photos of tickets/receipts through the same extraction pipeline).
- **Reminders (V1+)**: Resend (email) + Vercel Cron for scheduled checks.

## Architecture principles (non-negotiable, decided early to avoid rework)
1. **Multi-trip from day one.** Every reservation belongs to a "Trip"; a user can have many trips. Don't build a single-trip-implicit model.
2. **UTC storage + per-location timezone.** All timestamps stored in UTC; each location has a timezone (via Google Time Zone API). All duration math (travel time, free blocks) happens in UTC — never subtract displayed local times directly. Display converts to the relevant local timezone per leg (departure tz vs arrival tz), switching reference at actual arrival, not departure.
3. **Country-agnostic.** No hardcoded country/city/provider logic (e.g. no JR Pass–specific code). Anything country-specific is data/config, never code.
4. **AI never invents places.** LLMs translate user intent into structured filters sent to real APIs (Google Places) — never generate place suggestions from general knowledge. Avoids hallucinated/closed venues.
5. **Shared UI templates.** One menu template (header + "+" button top-right + list-row: icon/title/status) reused across Stay, Transport, Activities, Budget — not rebuilt per screen. One shared "Add" bottom sheet (type selector first, conditional fields) for all booking types. One shared detail screen for all item types.
6. **Date-grouped lists, not date-in-subtitle.** List menus group items under date/period headers so gaps are visually obvious (critical for Stay — an uncovered date range must show as its own flagged section, not a silent absence).
7. **UI text centralized** (i18n-ready) — English is the default display language, but strings aren't hardcoded per-screen, to allow adding languages later without rewrites.
8. **Role model ready for multi-person use.** A trip has an Organizer (full access) and can have Travelers (real account, scoped access) — this also happens to make the app viable for someone planning trips on behalf of others (or, longer-term, a travel-agency-style use case), without needing rework.

## V0.5 priority backlog (build this first — see Notion "Backlog" database for the full list)
- Trip data model (multi-trip) + anonymous Supabase auth
- Trips list screen (home) + create-trip form
- Manual reservation entry form (type, name, address, dates, price, 3-state status, note)
- Geocoding + travel-time integration
- Timeline generation with free-time-block calculation (UTC-based)
- Overview screen: map (tap to fullscreen) + "Needs attention" action list (bookings to make + dated reminders, sorted by urgency) — NOT a full duplicate list of every reservation
- Stay / Transport / Activities menus using the shared list template, grouped by date
- Accommodation coverage-gap detection (flag uncovered nights explicitly)
- Shared detail screen (view/edit any item type)
- Shared "Add" bottom sheet
- Check-in deadline + parking flags for Stay items

## Explicitly out of scope for V0.5
Email/PDF/photo import parsing, Google Places suggestions/bookmarking, budget aggregation, notifications/reminders, multi-person sharing, offline mode, natural-language search, anecdotes/journal features. These are real, tracked in the Notion Backlog under later phases (V1 / V1.5 / V2) — don't build them now, but don't design V0.5 in a way that blocks them either.

## Source of truth
Full backlog, decision history, and reasoning for every choice above live in Notion: pages **"Tabi — Product Strategy"**, **"Decision Log"**, and **"Backlog"**. When in doubt about *why* something is built a certain way, that's where the reasoning is — ask the user to paste the relevant entry if needed.

## Workflow (non-negotiable)
- **Always work from the Notion "Backlog" database.** Before starting any feature/fix, check the Backlog for the corresponding task (via the Notion MCP tools) instead of inventing scope — it is the authoritative task list, not this file.
- **Always update the task in Notion after finishing work on it.** Mark it done / update its status and add relevant notes in the Backlog entry once the corresponding work is complete — don't leave Notion out of sync with what's actually shipped.

- **RLS activé dès le schéma initial** (pas ajouté après coup) : chaque table (Voyage, Réservation, Activité, Notes...) doit avoir des policies Supabase garantissant qu'un utilisateur n'accède qu'aux voyages où il est Organisateur ou Voyageur. Garantie au niveau base de données, pas seulement filtrée côté code.

- **Clés API toujours côté serveur** : aucune clé (Claude, Google Maps/Places, Resend) ne doit apparaître dans le code exécuté par le navigateur. Tous les appels passent par des fonctions serveur (Supabase Edge Functions ou Vercel Functions).