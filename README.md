# Assignment Submission Portal

A university portal where students submit coursework and lecturers grade it —
now backed by a real server, a database, and proper accounts instead of
browser `localStorage`.

## What's new in this version

- **Server-side login & database storage** — a Node.js HTTP server backs the
  app, with all users, sessions, assignments, and submissions stored in a
  SQLite-compatible database — either a local file for development, or
  [Turso](https://turso.tech)'s free cloud database for reliable hosting
  (see Deployment below). Not stored in the browser.
- **Secure authentication** — passwords are hashed with `scrypt` (a salted,
  slow hash) before storage; they are never stored or transmitted in plain
  text after registration. Sessions use random 256-bit tokens in `HttpOnly`
  cookies, so they can't be read or stolen via JavaScript.
- **Session expiration** — sessions automatically expire after 45 minutes of
  inactivity, and after 12 hours no matter what. Expired sessions are
  rejected server-side and the app returns you to the login screen.
- **Matric numbers for students** — students provide a matric number at
  registration (required, must be unique). It shows up on their profile,
  on every submission a lecturer reviews, and in the grade export below.
- **Profile pages** — every account has a Profile tab to view their details
  and update their display name or password.
- **Multiple assignment deadlines** — lecturers create individual assignments
  per course, each with its own due date. Students pick the specific
  assignment they're submitting for, and see its deadline before uploading.
- **Admin user management** — the first account ever created on a fresh
  install automatically becomes an Administrator. Admins get a User
  Management tab to promote/demote roles, deactivate accounts, or delete
  users (the system always keeps at least one active administrator).
- **One-click grade export to Excel** — lecturers/admins can download a
  `.xlsx` spreadsheet of every graded submission (student name, matric
  number, course, assignment, grade, feedback, graded date) straight from
  the dashboard, optionally filtered to the currently-selected course. The
  file is built with a small dependency-free `.xlsx` writer
  (`lib/xlsx.js`) — no extra npm packages required.

No demo accounts are pre-installed or displayed anywhere in the app —
every account is created through Register. The first person to register
becomes Administrator automatically; everyone after that chooses Student
or Lecturer.

## Requirements

- **Node.js v18 or later.**
- One npm dependency: `@libsql/client` (a small, actively maintained SQLite
  driver). Install it with:

```bash
npm install
```

Check your Node version with:

```bash
node -v
```

If you're on an older version, upgrade at https://nodejs.org.

## How to Run (locally)

```bash
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

The first account you register becomes the portal Administrator
automatically — there's no separate setup step or hidden password.

By default this stores data in a local file (`data/portal.db`), which is
fine for local use but resets on hosts with ephemeral disks (see below).

To use a different port:

```bash
PORT=8080 node server.js
```

## Deployment — free, reliable hosting with Turso

Free hosting tiers (Render Free, Vercel, etc.) don't give you a persistent
disk, so a database file on local disk gets wiped whenever the service
restarts or wakes up from being idle. That shows up as accounts vanishing
and "invalid credentials" on login even with the right password.

The fix: point the app at **Turso** (https://turso.tech) — a free,
SQLite-compatible cloud database. No credit card required. Your data lives
in the cloud instead of on the host's disk, so it survives restarts,
redeploys, and free-tier spin-downs.

**Setup (one-time, ~5 minutes):**

1. Sign up at https://turso.tech and create a database (their dashboard
   walks you through it — pick any name and region).
2. From the database's dashboard, copy its **URL** (starts with
   `libsql://...`) and generate an **auth token**.
3. On your hosting platform (Render, etc.), add two environment variables:
   - `TURSO_DATABASE_URL` = the URL you copied
   - `TURSO_AUTH_TOKEN` = the token you generated
4. Redeploy. The server will log `Using Turso cloud database` on startup
   to confirm it picked up the new settings.

That's it — no code changes needed. If `TURSO_DATABASE_URL` isn't set, the
app automatically falls back to the local file, so local development with
plain `node server.js` keeps working exactly as before.

You can also point the local-file mode at a specific path (e.g. a mounted
persistent volume on a paid host) with `DB_PATH`:

```bash
DB_PATH=/data/portal.db node server.js
```

## How to Use

1. Register an account — the first one becomes Admin, later ones choose
   Student or Lecturer. Students also provide a matric number.
2. **Lecturers** create assignments (course, title, description, due date)
   under Manage Assignments, then grade submissions from the dashboard.
3. **Students** pick a course and assignment, then upload a PDF (max 2MB)
   with optional notes.
4. **Admins** manage assignments and grading like a lecturer, plus have a
   User Management tab to control roles and accounts.
5. Everyone has a Profile tab to update their name or password.
6. Lecturers/admins can click **Download Grades (Excel)** on the dashboard
   at any time to export all graded submissions as a spreadsheet.

## File Structure

```
server.js         — HTTP server, routing, and the REST API
lib/db.js         — database connection (local file or Turso) and migrations
lib/auth.js       — password hashing and session management
lib/store.js      — data access layer (users, assignments, submissions)
lib/xlsx.js       — dependency-free .xlsx (Excel) file writer
public/index.html — page markup
public/main.css   — styling
public/app.js     — frontend logic (calls the REST API)
data/portal.db    — SQLite database file (created automatically on first run)
```

## Security notes

This is a solid foundation for a coursework/portfolio project, with real
password hashing, server-side sessions, and role-based access control on
every API route. Before using it for anything with real student data,
you'd still want to add: HTTPS/TLS termination, rate limiting on login and
registration, CSRF tokens, structured logging/auditing, and a proper backup
strategy for the database file.

## Future Improvements

- Email verification and password-reset flows
- File storage on disk/object storage instead of base64-in-database, for
  larger uploads
- Notifications when an assignment is graded or a deadline approaches
- Bulk actions in the admin panel (CSV export, bulk role changes)
